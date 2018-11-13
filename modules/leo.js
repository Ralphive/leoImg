module.exports = {
    UpdateVectorsBase: function () {
        return UpdateVectorsBase();
    },

    GetSimilarItems: function (res, callback) {
        return GetSimilarItems(res, callback);
    },
    Categorize: function (res, callback) {
        return Categorize(res, callback);
    }
}


//Load Node Modules
var archiver = require('archiver');
var formidable = require('formidable');
var request = require('request');
var uuid = require('node-uuid');
var fs = require('fs');
var path = require('path');

var dbDir = path.join(process.env.IMAGE_DIR, "db");
var LeoServer = process.env.LEO_SERVER || "https://sandbox.api.sap.com/ml"

console.log("Storing images on: " + dbDir);

function UpdateVectorsBase() {
    /*
    This functions reads all images in the folder, creates a zip, 
    calls SAP Leonardo Image Feature Extraction API and store the results 
    on the vector directory to be used later for Image Comparision
    */

    console.log('Updating Item Image Vectors Database')

    var zipFile = uuid.v4() + '.zip';
    var zipPath = path.join(dbDir, zipFile);

    // create a file to stream archive data to. 
    var output = fs.createWriteStream(zipPath);
    var archive = archiver('zip', { zlib: { level: 9 } }); // Sets the compression level. 

    // listen for all archive data to be written 
    output.on('close', function () {

        extractVectors(zipPath, function (vectors) {

            //Creates a New Zip File with the vectors of each image
            vectors = JSON.parse(vectors);
            if (vectors.predictions.length <= 0) {
                console.error('Could not retrieve vectors from Leonardo');
                console.error(vectors);
                return;
            }

            for (var i = 0; i < vectors.predictions.length; i++) {
                //Change file extension 
                var fileName = vectors.predictions[i].name
                fileName = fileName.substr(0, fileName.indexOf('.')) + '.txt'

                var newTxt = fs.createWriteStream(path.join(process.env.VECTOR_DIR, fileName));
                var content = JSON.stringify(vectors.predictions[i].feature_vector);
                newTxt.write(content);
                newTxt.end()
                console.log('Creating file ' + fileName);
            }
        });
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors) 
    archive.on('warning', function (err) {
        if (err.code === 'ENOENT') {
            // log warning 
        } else {
            // throw error 
            throw err;
        }
    });

    // good practice to catch this error explicitly 
    archive.on('error', function (err) {
        throw err;
    });

    // pipe archive data to the file 
    archive.pipe(output);

    fs.readdirSync(process.env.IMAGE_DIR).forEach(file => {
        // append img files from stream

        if (file.indexOf('.png') !== -1 || file.indexOf('.jpg') !== -1 || file.indexOf('.jpeg') !== -1) {
            var file1 = path.join(process.env.IMAGE_DIR , file);
            archive.append(fs.createReadStream(file1), { name: file });
            console.log(file);
        }
    })

    // finalize the archive (ie we are done appending files but streams have to finish yet) 
    archive.finalize();

}

function extractVectors(file, callback) {

    // More info on
    // https://help.sap.com/viewer/product/SAP_LEONARDO_MACHINE_LEARNING_FOUNDATION/1.0/en-US
    var endpoint = process.env.LEO_FEATUREX_ENDPOINT || '/imagefeatureextraction/feature-extraction'
    var options = {
        url: LeoServer+endpoint,
        headers: {
            'APIKey': process.env.LEO_API_KEY,
            'Accept': 'application/json'
        },
        formData: {
            files: fs.createReadStream(file)
        },
    }

    request.post(options, function (err, res, body) {
        if (res.statusCode != 200) {
            callback(body,res.statusMessage)
        }
        else {
            callback(body);

        }
    });
}

function GetSimilarItems(req, callback) {
    /* this function uploads a image file to the  upload folder,
    * then it creates a copy of the Vectors zip (created by UpdateVectorsBase())
    * adds the uploaded image to that copy so it can be compared by SAP Leonardo in 
    * order to find the top X similar items */

    //Upload File to Server   
    uploadFile(req, function (file, err) {
        if (!err) {
            //Extract Vector of Image
            extractVectors(file, function (vector, err) {
                if (!err) {
                    // Compare this image with the ones stored in the server
                    getSimilatiryScoring(vector, function (base, similars, err) {
                        if (!err) {
                            var resp = similars;

                            for (var i = 0; i < resp.predictions.length; i++) {
                                if (resp.predictions[i].id == base) {
                                    resp.predictions = resp.predictions[i].similarVectors
                                    for (var j = 0; j < resp.predictions.length; j++) {
                                        var fileName = resp.predictions[j].id
                                        fileName = fileName.substr(0, fileName.indexOf('.')) + '.jpg'
                                        resp.predictions[j].id = fileName
                                    }

                                    callback(null, resp);
                                }
                            }
                        } else {
                            console.error("ERROR Getting Similarity Score")
                            console.error(err)
                            callback(err, resp);
                        }
                    })
                }
                else {
                    console.error("ERROR Extracting Vectors")
                    console.error(err, vector)
                    callback(err, vector);
                }
            })
        } else {
            console.error("ERROR Uploading File")
            console.error(err)
            callback(err);
        }
    })

}

function Categorize(req, callback) {
    /* this function uploads a image file to the  upload folder,
    * then it creates a copy of the Vectors zip (created by UpdateVectorsBase())
    * adds the uploaded image to that copy so it can be compared by SAP Leonardo in 
    * order to find the top X similar items */

    //Upload File to Server   
    uploadFile(req, function (file, err) {
        if (!err) {
            categorizeImg(file, callback)
        }
    })

}

function uploadFile(req, callback) {

    // create an incoming form object
    var form = new formidable.IncomingForm();
    // specify that we want to allow the user to upload multiple files in a single request
    form.multiples = false;
    // store all uploads in the /uploads directory
    form.uploadDir = process.env.UPLOAD_DIR;

    // File uploaded successfuly. 
    form.on('file', function (field, file) {
        fs.rename(file.path, file.path + '.jpg');
        //Callback with the route to the file in the server
        callback(file.path + '.jpg');
    });

    // log any errors that occur
    form.on('error', function (err) {
        console.log('An error has occured uploaiding the file: \n' + err);
        callback(null, err);
    });

    form.on('end', function (a,b,c) {
        console.dir(a)
        console.dir(b)
        console.dir(c)
    });

    // parse the incoming request containing the form data
    form.parse(req, function (err, fields, files) {
        console.log(files)
    });


}

function getSimilatiryScoring(vectors, callback) {
    vectors = JSON.parse(vectors);

    // Create e zip file of vectors to be used by the Similarity scoring service 
    var zipFile = uuid.v4() + '.zip';

    // create a file to stream archive data to the zip
    var output = fs.createWriteStream(path.join(dbDir, zipFile));
    var archive = archiver('zip', { zlib: { level: 9 } }); // Sets the compression level. 

    // listen for all archive data to be written 
    output.on('close', function () {
        var endpoint = process.env.LEO_SIMILARITY_ENDPOINT || 'similarityscoring/similarity-scoring'
        var options = {
            url: LeoServer+endpoint,
            headers: {
                'APIKey': process.env.LEO_API_KEY,
                'Accept': 'application/json',
            },
            formData: {
                files: fs.createReadStream(path.join(dbDir, zipFile)),
                options: "{\"numSimilarVectors\":3}"
            }
        }

        request.post(options, function (err, res, body) {
            if (res.statusCode != 200) {
                callback(null,JSON.parse(body),res.statusMessage)
            }
            else {
                callback(fileName, JSON.parse(body),null);
    
            }
        });

    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors) 
    archive.on('warning', function (err) {
        if (err.code === 'ENOENT') {
            // log warning 
        } else {
            // throw error 
            throw err;
        }
    });

    // good practice to catch this error explicitly 
    archive.on('error', function (err) {
        throw err;
    });

    // pipe archive data to the file 
    archive.pipe(output);

    var buff = Buffer.from(JSON.stringify(vectors.predictions[0].feature_vector), "utf8");
    var fileName = vectors.predictions[0].name
    fileName = fileName.substr(0, fileName.indexOf('.')) + '.txt'
    archive.append(buff, { name: fileName });

    fs.readdirSync(process.env.VECTOR_DIR).forEach(file => {
        // append txt vector files from stream to the zip 
        if (file.indexOf('.txt') !== -1) {
            archive.append(fs.createReadStream(path.join(process.env.VECTOR_DIR, file)), { name: file });
        }
    })

    // finalize the archive (ie we are done appending files but streams have to finish yet) 
    archive.finalize();

}

function categorizeImg(file, callback) {
    // More info on
    var endpoint = process.env.LEO_IMAGE_CLASSIFY || '/imageclassification/classification'
    var options = {
        url: LeoServer+endpoint,
        headers: {
            'APIKey': process.env.LEO_API_KEY,
            'Accept': 'application/json'
        },
        formData: {
            files: fs.createReadStream(file)
        },
    }

    request.post(options, function (err, res, body) {
        if (res.statusCode != 200) {
            callback("Error Categorizing Image - " + res.statusCode, JSON.parse(body));
        }
        else {
            callback(null, JSON.parse(body));
        }
    });

}