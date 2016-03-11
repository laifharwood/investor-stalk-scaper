var feed = require('feed-read');
var cheerio = require('cheerio');
var request = require('request');
var orientdb = require('orientjs');
var express = require ('express');
var underscore = require('underscore');
var server = orientdb({
    host: 'localhost',
    port: 2424,
    username: 'root',
    password: 'password'
});
var db = server.use('Stocks');
var resultsCount = 20
var url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=sc%2013d&company=&dateb=&owner=include&start=0&count=' + resultsCount + '&output=atom';
var dataObject = underscore.range(resultsCount).map(function(){
   return {};
});
var totalNumberOfDataProperties = 0;
var accessionNumbers = [];
var CIKs = [];
var newAccessionNumbers = [];
var newCIKs = [];
var numberOfResultsProcessed = 0;
var numberOfMilliSeconds = 30000;

//Functions
var getAccessionNumbers = function(object){
    db.select('accessionNumber').from('ThirteenD').column('accessionNumber').all().then(function(accessionNumbersResults){
        accessionNumbers = accessionNumbersResults;
        getCIKs(object);
    });
};
var getCIKs = function(object){
    db.select('CIK').from('Investor').column('CIK').all().then(function(CIKResults){
        CIKs = CIKResults;
        writeToDbEach(object);
    });
};
var writeToDbEach = function(object){
    if ((accessionNumbers.indexOf(object.accessionNumber) > -1) || (newAccessionNumbers.indexOf(object.accessionNumber) > -1)){
        //console.log('Not Unique');
        ++numberOfResultsProcessed
        if (numberOfResultsProcessed >= resultsCount){
            numberOfResultsProcessed = 0;
            console.log('setTimeout Called');
            setTimeout(getFeed(), numberOfMilliSeconds);
        };
    }else{
        //console.log('Unique');
        newAccessionNumbers.push(object.accessionNumber);
        db.let('subject', function(s){

            if ((CIKs.indexOf(object.subjectCIK) > -1) || (newCIKs.indexOf(object.subjectCIK) > -1) ){
                //Get Subject Object
                s.select().from('Investor').where({CIK : object.subjectCIK});
            }else{
                newCIKs.push(object.subjectCIK);
                s
                .create('vertex', 'Company')
                .set({
                    name: object.subjectName,
                    CIK: object.subjectCIK
                });
            };
        })
        .let('filer', function(s){
            if ((CIKs.indexOf(object.filerCIK) > -1) || (newCIKs.indexOf(object.filerCIK) > -1)){
                //Get Subject Object
                s.select().from('Investor').where({CIK : object.filerCIK});
            }else{
                newCIKs.push(object.filerCIK);
                s.create('vertex', 'Investor')
                .set({
                    name: object.filerName,
                    CIK: object.filerCIK
                });
            };
        })
        .let('thirteenD', function(s){
            s.create('vertex', 'ThirteenD')
            .set({
                accessionNumber: object.accessionNumber,
                percent: object.percentOwned,
                date: new Date()
            });
        })
        .let('filedBy', function(s){
            s.create('edge', 'filedBy')
            .from('$filer')
            .to('$thirteenD')
        })
        .let('subjectOf', function(s){
            s.create('edge', 'subjectOf')
            .from('$subject')
            .to('$thirteenD')
        })
        .commit()
        .return('$thirteenD')
        .all()
        .then(function(results){
            console.log('done');
            //proccess.exit();
        })
        .done();
        ++numberOfResultsProcessed
        if (numberOfResultsProcessed >= resultsCount){
            numberOfResultsProcessed = 0;
            console.log('setTimeout Called');
            setTimeout(getFeed(), numberOfMilliSeconds);
        };
    };
};
var dataBuilder = function (property, value, index){
    ++totalNumberOfDataProperties;
   var object = dataObject[index];
    object[property] = value;
    dataObject.splice(index, 1, object);
    //console.log(dataObject);
    var totalBuildsRequired = dataObject.length * 7
    if (totalNumberOfDataProperties >= totalBuildsRequired){
        //console.log(dataObject);
        writeToDataBase(dataObject);
    }
};
var writeToDataBase = function(dataObjectToBeWritten){
    dataObjectToBeWritten.forEach(function(object, indexOfObject){
        getAccessionNumbers(object);
        //console.log(object);
    });
};
var firstRequest = function(indexLoop, link){
    request(link, function(error, response, body){
        if (error) throw error;
        var $ = cheerio.load(body);
        var accessionNum = $('#secNum').text();
        accessionNum = accessionNum.substring(28); //Check if unique
        accessionNum = accessionNum.replace(/\s+/g, '');
        dataBuilder('accessionNumber', accessionNum, indexLoop);
        $('#contentDiv').children('#filerDiv').each(function(indexLocal, elem){
            var name = $(this).children('.companyInfo').children('.companyName').first().text()
            if (name.indexOf('(Subject)') > 0) {
                //subject
                var subjectName;
                var subjectCIK;
                var longSubjectName = $(this).children('.companyInfo').children('.companyName').first().text();
                var endIndex = longSubjectName.indexOf('(Subject)');
                subjectName = longSubjectName.substr(0, endIndex - 1);
                dataBuilder('subjectName', subjectName, indexLoop);
                var longSubjectCIK = $(this).children('.companyInfo').children('.companyName').children('a').text();
                subjectCIK = longSubjectCIK.substr(0,10); //Check if Unique to add to database
                dataBuilder('subjectCIK', subjectCIK, indexLoop);
            }else if (name.indexOf('(Filed by)') > 0) {
                //filed by
                var filerName;
                var filerCIK;
                var longFilerName = $(this).children('.companyInfo').children('.companyName').first().text();
                var endIndex = longFilerName.indexOf('(Filed by)')
                filerName = longFilerName.substr(0, endIndex - 1);
                dataBuilder('filerName', filerName, indexLoop);
                var longFilerCIK = $(this).children('.companyInfo').children('.companyName').children('a').text();
                filerCIK = longFilerCIK.substr(0,10); //Check if Unique to add to database
                dataBuilder('filerCIK', filerCIK, indexLoop);
            };
        });
        var finalLinkHref = $('#contentDiv').children('#formDiv').children().eq(2).children('.tableFile').children().eq(1).children().eq(2).children('a').attr('href');
        var finalLink = 'http://www.sec.gov' + finalLinkHref; //This is the source link
        dataBuilder('sourceLink', finalLink, indexLoop);
        secondRequestForPercent(finalLink, indexLoop);
    });//End First Request
};//End first Request Function
var secondRequestForPercent = function(finalLink, indexLoop){
    request(finalLink, function(error, response, body){
        if (error) throw error;
        var percentOwned;
        var percentOwnedParse = function(bodyOfDoc, percentVar){
            bodyOfDoc = bodyOfDoc.replace(/\s+/g, '')
            bodyOfDoc = bodyOfDoc.toLowerCase();
            var indexOfTitle = bodyOfDoc.indexOf('percentofclass');
            if (indexOfTitle > -1){
                var startingIndex = indexOfTitle;
                var removeFirstHalfString = bodyOfDoc.substr(startingIndex);
                var indexOfPercentSign = removeFirstHalfString.indexOf('%');
                if (indexOfPercentSign > 80 || indexOfPercentSign < 0) {
                    percentVar = -1;
                }else if (indexOfPercentSign < 80 && indexOfPercentSign > 0){
                    percentVar = removeFirstHalfString.substr(0, indexOfPercentSign);
                    var indexOptionOne = percentVar.indexOf('w(11):');
                    var indexOptionTwo = percentVar.indexOf('w11:');
                    var indexOptionThree = percentVar.indexOf('w(11)');
                    var indexOptionFour = percentVar.indexOf('w11');
                    var indexOptionFive = percentVar.indexOf('(seeitem5)');
                    var indexOptionSix = percentVar.indexOf('1)1)');
                    if (indexOptionFive > -1){
                        percentVar = percentVar.substr(indexOptionFive + 10)
                    }else if (indexOptionSix > -1){
                        percentVar = percentVar.substr(indexOptionSix + 4)
                    }else if (indexOptionOne > -1){
                        percentVar = percentVar.substr(indexOptionOne + 6);
                    }else if (indexOptionTwo > -1){
                        percentVar = percentVar.substr(indexOptionTwo + 4);
                    }else if (indexOptionThree > -1){
                        percentVar = percentVar.substr(indexOptionThree + 5);
                    }else if (indexOptionFour > -1){
                        percentVar = percentVar.substr(indexOptionFour + 3);
                    }

                };//End of check for existence of % Sign

            }else{
                percentVar = -1;
            };//End index of title could not be found
            if (isNaN(percentVar)){
                percentVar = -1;
            };
            dataBuilder('percentOwned', percentVar, indexLoop);
            //console.log(percentVar);
        };//End PercentOwedParse Fuction
        if (finalLink.indexOf('.txt') < 0){
            var $ = cheerio.load(body);
            var bodyOfDoc = $('body').text();
            percentOwnedParse(bodyOfDoc, percentOwned);
        }else{
            percentOwnedParse(body, percentOwned);
        };
    });//End second Request to get percent owned
};
var getFeed = function(){
    feed(url, function(err, content){
        if (err) throw err;
        content.forEach(function(contentItem, indexLoop){
            var link = contentItem.link;
            firstRequest(indexLoop, link);
        });//end loop
    });//End Feed
};

getFeed();
