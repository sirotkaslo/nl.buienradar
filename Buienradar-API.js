//Homey.manager('api').get('/managers/geolocation/', function( result ){
//    Homey.log( result );
//});

var lat = 52.221537;
var lon = 6.893662;
var rain_found = 0;
var i;

function will_it_rain() {
    var request = require('request');
    //request('http://gps.buienradar.nl/getrr.php?lat=' + lat + '&lon=' + lon, function (error, response, body) {
    request('http://boelders.nl/uni/test/test-api.html', function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var array = body.split('\r\n'); //split into seperate items

        for (i = 1; i < 7; i++) { //get the coming 30 min (ignore first 2 items)
        	var array2 = array[i].split('|'); //split rain and time

        	if (array2[0] > 0 && rain_found != 1){ //if rain is more then 0 and not already found
        		var rainTime = array2[1];
    			var rainMinute = parseInt(rainTime.substr(rainTime.indexOf(":") + 1));
                var rainHours = parseInt(rainTime.substr(rainTime.indexOf(":") - 2, 2));
                var d = new Date();
                var hours = d.getHours();
                var currentMinute = d.getMinutes();

                if (hours == rainHours) {
                    var difMinute = rainMinute - currentMinute;
                }
                else {
                    var difMinute = 60 - currentMinute + rainMinute;
                }

    			var rain_found = 1;

                console.log(rain_found);
        	}
        }
      }
    })
    setTimeout(will_it_rain, 1000);
};

will_it_rain(); // call function

if (rain_found == 1) {
        console.log("It's going to rain within the next " + difMinute +" min");
    } else {
        console.log("No rain expected within the next 30 min")
    }