//Load Node Modules
var archiver = require('archiver');
var formidable = require('formidable');
var request = require('request');
var uuid = require('node-uuid');
var fs = require('fs');
var path = require('path');

var __dirname = process.env.IMAGE_DIR

console.log("Storing images on: "+ __dirname);

module.exports = {
    UpdateVectorsBase :function (){                
                return UpdateVectorsBase();
        },

    GetSimilarItems: function(res,callback){
        return GetSimilarItems(res, callback);
        console.log('GetSimilarItems');
    }
}

function UpdateVectorsBase(){
    /*
    This functions reads all images in the folder, creates a zip, 
    calls SAP Leonardo Image Feature Extraction API and store the results 
    on the vector directory to be used later for Image Comparision
    */

    console.log ('Updating Item Image Vectors Database')
    
    var zipFile = uuid.v4()+'.zip';

    // create a file to stream archive data to. 
    var output = fs.createWriteStream(process.env.IMAGE_DIR + zipFile);
    var archive = archiver('zip', {zlib: { level: 9 }}); // Sets the compression level. 

    // listen for all archive data to be written 
    output.on('close', function() {
       
        extractVectors(path.join(process.env.IMAGE_DIR,zipFile), function (vectors){
            
            //Creates a New Zip File with the vectors of each image
            vectors = JSON.parse(vectors);
            if (vectors.feature_vector_list.length <= 0){
                console.error('Could not retrieve vectors from Leonardo');
                console.error(vectors);
                return;
            }
    
            output = fs.createWriteStream(path.join(process.env.IMAGE_DIR,zipFile));

            for(var i = 0; i < vectors.feature_vector_list.length; i++ ){  
                //Change file extension 
                var fileName = vectors.feature_vector_list[i].name
                fileName = fileName.substr(0, fileName.indexOf('.'))+'.txt'
                
                var newTxt = fs.createWriteStream(path.join(process.env.VECTOR_DIR,fileName));
                var content = JSON.stringify(vectors.feature_vector_list[i].feature_vector);
                newTxt.write(content);
                newTxt.end()
                console.log('Creating file '+ fileName);
            }                
        });    
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors) 
    archive.on('warning', function(err) {
        if (err.code === 'ENOENT') {
            // log warning 
        } else {
            // throw error 
            throw err;
        }
    });

    // good practice to catch this error explicitly 
    archive.on('error', function(err) {
        throw err;
    });

    // pipe archive data to the file 
    archive.pipe(output);
    
    fs.readdirSync(__dirname).forEach(file => {
        // append img files from stream

        if(file.indexOf('.png') !== -1 ||file.indexOf('.jpg') !== -1 || file.indexOf('.jpeg') !== -1){
            var file1 = __dirname + '/'+file;
            archive.append(fs.createReadStream(file1), { name: file });
            console.log(file);
        }
    })
    
    // finalize the archive (ie we are done appending files but streams have to finish yet) 
    archive.finalize();

}

function extractVectors(file, callback){
    
    // More info on
    // https://help.sap.com/viewer/product/SAP_LEONARDO_MACHINE_LEARNING_FOUNDATION/1.0/en-US
    var options = {
        url: 'https://sandbox.api.sap.com/ml/featureextraction/inference_sync',
        headers: {
            'APIKey': process.env.LEO_API_KEY,
            'Accept': 'application/json'
          },
        formData :{
            files: fs.createReadStream(file)},
    }

    request.post(options, function (err, res, body) {
        if (err) {
            return console.error('extractVectors failed:', err);
            throw err;
        }
        else{
            return callback(body);

        }
      });
}

function GetSimilarItems(req, callback){
    /* this function uploads a image file to the  upload folder,
    * then it creates a copy of the Vectors zip (created by UpdateVectorsBase())
    * adds the uploaded image to that copy so it can be compared by SAP Leonardo in 
    * order to find the top X similar items */

    //Upload File to Server   
    uploadFile(req, function(file, err){
        if (!err){
            //Extract Vector of Image
            extractVectors(file,function(vector,err){
                if (!err){
                    // Compare this image with the ones stored in the server
                    getSimilatiryScoring(vector, function(base, similars,err){
                        if (!err){
                            var resp = similars;

                            for (var i = 0; i < resp.similarityScoring.length; i++){                            
                                if (resp.similarityScoring[i].id == base){
                                    resp.similarityScoring = resp.similarityScoring[i].similarVectors
                                    for (var j =0; j < resp.similarityScoring.length; j++){
                                        var fileName = resp.similarityScoring[j].id
                                        fileName = fileName.substr(0, fileName.indexOf('.'))+'.jpg'
                                        resp.similarityScoring[j].id = fileName 
                                    }

                                    callback(resp);                                    
                                }
                            }
                            //callback(resp);
                        }
                    })
                }
            })
        }
    })

}

function uploadFile(req,callback){

  // create an incoming form object
  var form = new formidable.IncomingForm();
  // specify that we want to allow the user to upload multiple files in a single request
  form.multiples = false;    
  // store all uploads in the /uploads directory
  form.uploadDir = process.env.UPLOAD_DIR;

  // File uploaded successfuly. 
  form.on('file', function(field, file) {
    fs.rename(file.path, file.path+'.jpg'); 
    //Callback with the route to the file in the server
    callback(file.path+'.jpg');
  });

  // log any errors that occur
  form.on('error', function(err) {
      console.log('An error has occured uploaiding the file: \n' + err);
      callback(null, err);
  });

  form.on('end', function() {
  }); 
  
  // parse the incoming request containing the form data
  form.parse(req, function(err, fields, files){
      console.log(files)
  });


}

function getSimilatiryScoring(vectors,callback){
    vectors = JSON.parse(vectors);

    // Create e zip file of vectors to be used by the Similarity scoring service 
    var zipFile = uuid.v4()+'.zip';
    
    // create a file to stream archive data to the zip
    var output = fs.createWriteStream(path.join(process.env.IMAGE_DIR,zipFile));
    var archive = archiver('zip', {zlib: { level: 9 }}); // Sets the compression level. 
    
    // listen for all archive data to be written 
    output.on('close', function() {
        
        var options = {
                url: 'https://sandbox.api.sap.com/ml/similarityscoring/inference_sync',
                headers: {
                    'APIKey': process.env.LEO_API_KEY
                    'Accept': 'application/json',
                },
                formData :{
                    files: fs.createReadStream(path.join(process.env.IMAGE_DIR,zipFile)),
                    options: "{\"numSimilarVectors\":3}"
                }
            }    
    
        request.post(options, function (err, res, body) {
            if (err) {
                return console.error('Similarity Scoring failed:', err);
                throw err;
            }
            else{
                return callback(fileName, JSON.parse(body));
            }
          });        

    });
    
    // good practice to catch warnings (ie stat failures and other non-blocking errors) 
    archive.on('warning', function(err) {
        if (err.code === 'ENOENT') {
            // log warning 
        } else {
            // throw error 
            throw err;
        }
    });

    // good practice to catch this error explicitly 
    archive.on('error', function(err) {
        throw err;
    });

    // pipe archive data to the file 
    archive.pipe(output);
    
    var buff =  Buffer.from(JSON.stringify(vectors.feature_vector_list[0].feature_vector), "utf8");
    var fileName = vectors.feature_vector_list[0].name
    fileName = fileName.substr(0, fileName.indexOf('.'))+'.txt'
    archive.append(buff,{ name: fileName});
    
    fs.readdirSync(process.env.VECTOR_DIR).forEach(file => {
        // append txt vector files from stream to the zip 
        if(file.indexOf('.txt') !== -1){
            archive.append(fs.createReadStream(path.join(process.env.VECTOR_DIR,file)), { name: file });
        }
    })
        
    // finalize the archive (ie we are done appending files but streams have to finish yet) 
    archive.finalize();
  
}