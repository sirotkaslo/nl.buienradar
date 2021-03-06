'use strict';

const request = require('request');
const geodist = require('geodist');
var xmlParser = new require('xml2js').Parser({ explicitArray: false });

/**
 * The Buienradar API object
 */
const Buienradar = module.exports = function Buienradar(config) {
	if (!(this instanceof Buienradar)) {
		return new Buienradar(config);
	}

	if (!config || !config.lat || !config.lon) {
		return new Error('Buienradar should be initiated with lat and lon config');
	}

	this.lat = Math.round(config.lat * 100) / 100;
	this.lon = Math.round(config.lon * 100) / 100;

	this.requestCacheTimeout = config.requestCacheTimeout || 1000;
};

Buienradar.rainIndicators = {
	NO_RAIN: 0.1,
	LIGHT_RAIN: 2.5,
	MODERATE_RAIN: 10,
	HEAVY_RAIN: 50,
	VIOLENT_RAIN: 51
};

(function () {

	/**
	 * Change the lat/lon the api uses.
	 * @param lat the latitude
	 * @param lon the longitude
	 */
	this.setLatLon = function (lat, lon) {
		if (!lon && lat && lat.lat) {
			lon = lat.lon;
			lat = lat.lat;
		}
		if (isNaN(lat) || isNaN(lon)) {
			throw new Error('new location is incorrect!');
		}
		this.lat = Math.round(lat * 100) / 100;
		this.lon = Math.round(lon * 100) / 100;
		this.resetCache();
	};

	this.hasLocation = function () {
		return typeof this.lat === 'number' && typeof this.lon === 'number';
	};

	/**
	 * Maps the amount of rainfall to a number representation of which you can check the constants
	 * e.g. result.indication === Buienradar.rainIndicators.LIGHT_RAIN
	 * or   result.indication >= Buienradar.rainIndicators.MODERATE_RAIN
	 * @param amount amount of rain in mm
	 * @returns {Buienradar.rainIndicators}
	 */
	this.getRainIndication = function (amount) {
		if (isNaN(amount)) {
			return false;
		}
		if (amount < 0.1) {
			return Buienradar.rainIndicators.NO_RAIN;
		} else if (amount < 2.5) {
			return Buienradar.rainIndicators.LIGHT_RAIN;
		} else if (amount < 10) {
			return Buienradar.rainIndicators.MODERATE_RAIN;
		} else if (amount < 50) {
			return Buienradar.rainIndicators.HEAVY_RAIN;
		} else {
			return Buienradar.rainIndicators.VIOLENT_RAIN;
		}
	};

	const rainDataRegex = /(\d*)\|([\d:]*)/g;
	/**
	 * Returns raw data from api webserver
	 * @returns {Promise.<String>}
	 */
	this.getRawRainData = function () {
		if (!this.lat || !this.lon) {
			return Promise.reject(new Error('Location is not set properly, please check location settings and try again.'));
		}

		let responseCounter = 0;
		const apiUrls = [
			`https://br-gpsgadget-new.azurewebsites.net/data/raintext?lat=${this.lat}&lon=${this.lon}`,
			`http://gps.buienradar.nl/getrr.php?lat=${this.lat}&lon=${this.lon}`,
		];

		return Promise.race(
			apiUrls.map((url, index, urlList) =>
				new Promise((res, rej) => {
					console.log('requesting data from', url);
					request(url, (error, response, body) => {
						if (error) console.error(error);

						console.log('got response', url, error, body);
						if (body && body.match(rainDataRegex)) {
							res(body);
						} else if (responseCounter === urlList.length) {
							rej(new Error('No url received rain data'));
						}
					});
				})
			).concat(new Promise((_, rej) => setTimeout(rej.bind(null, new Error('timeout')), 5000)))
		).catch(err => {
			console.log('Uneble to get rain data', err);
			return Promise.reject(err);
		});
	};


	let rainDataCache;
	/**
	 * returns an array of rainfall forecasts for the following 2 hours and caches the result for performance reasons.
	 * return object is an array with data objects like
	 * [{
   *  value       // the raw rain value from the buienradar api
   *  amount      // the amount of rain in mm/h
   *  time        // the timestamp of the prediction
   *  indication  // an indication value that can be checked with Buienradar.rainIndicators
   * },
	 * ...
	 * ]
	 * @param forceRefresh Force a new query to the Buienradar server (omit cached data)
	 * @returns {Promise.<Array>}
	 */
	this.getRainData = function (forceRefresh) {
		this.checkLocationChange();
		if (!forceRefresh && this.requestCacheTimeout && this.rainData) {
			return Promise.resolve(this.rainData);
		} else {
			return this.getRawRainData()
				.then(data => {
					console.log('Got rain data', data);
					return new Promise((resolve, reject) => {
						const result = [];

						let previousTime;
						if (data) {
							data.replace(rainDataRegex, (_, value, time) => {
								const amount = Math.round(Math.pow(10, (value - 109) / 32) * 100) / 100;
								if (!previousTime) {
									previousTime = new Date();
									previousTime.setHours.apply(previousTime, time.split(':').concat(0));
									if (previousTime.getTime() - Date.now() > 12 * 3600 * 1000) {
										previousTime = new Date(previousTime.getTime() + 24 * 3600 * 1000);
									}
									time = previousTime;
								} else {
									time = previousTime = new Date(previousTime.getTime() + 300 * 1000);
								}
								result.push({
									value,
									amount,
									time,
									indication: this.getRainIndication(amount)
								});
							});
						}

						if (result && result.length && result.length > 1) {
							resolve(result);
							if (this.requestCacheTimeout) {
								this.rainData = result;
								clearTimeout(this.rainDataCacheTimeout);
								this.rainDataCacheTimeout = setTimeout(
									() => this.rainData = null,
									this.requestCacheTimeout
								);
							}
						} else {
							reject(new Error('Could not get data from buienradar service, please try again later.'));
							this.rainData = null;
						}
					});
				});
		}
	};

	this.getRainDataFromArray = function (data) {
		return Promise.resolve(data.map((value, i) => {
			const amount = Math.round(Math.pow(10, (value - 109) / 32) * 100) / 100;
			return {
				value,
				amount,
				time: new Date(Date.now() + 300 * 1000 * i),
				indication: this.getRainIndication(amount)
			};
		}));
	};

	/**
	 * Returns raw data from api webserver
	 * @returns {Promise.<String>}
	 */
	this.getRawFeedData = function () {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{
					host: 'xml.buienradar.nl'
				},
				(response) => {
					let data = '';

					response.on('data', chunk => data += chunk);
					response.on('end', () => resolve(data));
				}
			);

			req.on('error', e => reject(e));

			req.end();
		});
	};

	let feedDataCache;
	/**
	 * This function parses the raw feed data into an object and caches it for performance reasons
	 * @returns {Promise.<Object>}
	 */
	this.getFeedData = function () {
		if (this.requestCacheTimeout && feedDataCache) {
			return feedDataCache;
		} else {
			return feedDataCache = this.getRawFeedData().then(data => {
				return new Promise((resolve, reject) => {
					xmlParser.parseString(data, (err, result) => {
						if (err) {
							reject(err);
							feedDataCache = null;
						} else if (!(result && result.buienradarnl && result.buienradarnl.weergegevens)) {
							reject(new Error('Got invalid response from server'));
							feedDataCache = null;
						} else {
							resolve(result.buienradarnl.weergegevens);
							if (this.requestCacheTimeout) {
								setTimeout(() => feedDataCache = null, this.requestCacheTimeout);
							}
						}
					});
				});
			});
		}
	};

	let nearestWeatherStationId;
	/**
	 * Looks up the nearest weather station and returns it's data object
	 * the data object has the following structure
	 * {
   *  stationcode,      // id of the weather station
   *  stationnaam: {
   *    _ ,             // weather station name
   *    '$'             // weather station region name
   *  },
   *  lat,              // latitude
   *  lon,              // longitude
   *  datum,            // date
   *  luchtvochtigheid, // humidity
   *  temperatuurGC,    // temperature in degrees centigrade
   *  windsnelheidMS,   // wind speed in meter/second
   *  windsnelheidBF,   // wind speed in Beaufort scale
   *  windrichtingGR,   // wind direction in degrees
   *  windrichting,     // string representation of wind direction
   *  luchtdruk         // air pressure
   *  zichtmeter,       // visibility distance
   *  windstotenMS,     // max winds in meter/second
   *  regenMMPU,        // rain in mm/hour
   * }
	 * @param requireParams an array of strings for which the params should not be empty. This can be used for instance
	 *            when the most local weather station does not have an air pressure sensor but you need that value.
	 * @returns {Promise.<Object>}
	 */
	this.getNearestWeatherStationData = function (requireParams) {
		this.checkLocationChange();
		return this.getFeedData().then(data => {
			return new Promise((resolve, reject) => {
				const weatherStationList = data.actueel_weer.weerstations.weerstation;

				const findNearestWeatherStation = () => {
					const location = { lat: this.lat, lon: this.lon };
					let result;
					let nearestDistance;
					weatherStationList.forEach(weatherStation => {
						if (requireParams) {
							let skip = false;
							requireParams.forEach(param => {
								skip = skip || !(weatherStation[param] && weatherStation[param] !== '-');
							});
							if (skip) {
								return;
							}
						}
						const dist = geodist(location, { lat: weatherStation.lat, lon: weatherStation.lon });
						if (!nearestDistance || dist < nearestDistance) {
							nearestDistance = dist;
							result = weatherStation;
						}
					});
					if (!result) {
						reject(new Error('Could not get nearest weather station from data'));
					} else {
						return result;
					}
				};

				let nearestWeatherStation;
				if (requireParams && requireParams.length) {
					requireParams.filter(param => param !== 'regenMMPU'); // filter regenMMPU since it is an exception
					nearestWeatherStation = findNearestWeatherStation();
				} else if (!nearestWeatherStationId) {
					nearestWeatherStation = findNearestWeatherStation();
					nearestWeatherStationId = nearestWeatherStation.stationcode;
				} else {
					nearestWeatherStation = data.find(weatherStation => weatherStation.stationcode === nearestWeatherStationId);
					if (!nearestWeatherStation) {
						nearestWeatherStation = findNearestWeatherStation();
					}
				}

				if (nearestWeatherStation.regenMMPU === '-') {
					nearestWeatherStation.regenMMPU = 0;
				}
				nearestWeatherStation.date = new Date(nearestWeatherStation);
				resolve(nearestWeatherStation);
			});
		});
	};

	/**
	 * Returns the 5 day weather forecast included in the buienradar data feed
	 * the data object has the following structure
	 * {
   *  tekst_middellang,
   *  tekst_lang,
   *  dagen: [
   *    {
   *       datum: 'vrijdag 13 mei 2016',
   *       dagweek: 'vr',
   *       kanszon: '60',
   *       kansregen: '10',
   *       minmmregen: '0',
   *       maxmmregen: '0',
   *       mintemp: '14',
   *       mintempmax: '14',
   *       maxtemp: '21',
   *       maxtempmax: '21',
   *       windrichting: 'N',
   *       windkracht: '4',
   *       sneeuwcms: '0' },
   *    }, ...
	 *  ]
	 * }
	 * @returns {Promise.<Object>}
	 */
	this.getWeatherForecast = function () {
		return this.getFeedData().then(data => {
			data.verwachting_meerdaags.dagen = [];
			let i = 1;
			while (data.verwachting_meerdaags[`dag-plus${i}`]) {

				data.verwachting_meerdaags.dagen.push(data.verwachting_meerdaags[`dag-plus${i}`]);
				delete data.verwachting_meerdaags[`dag-plus${i}`];
				i++;
			}
			data.verwachting_meerdaags.tekst_middellang = data.verwachting_meerdaags.tekst_middellang['$'];
			data.verwachting_meerdaags.tekst_lang = data.verwachting_meerdaags.tekst_lang['$'];
			return Promise.resolve(data.verwachting_meerdaags);
		});
	};

	/**
	 * Returns the current day weather forecast included in the buienradar data feed
	 * @returns {Promise.<Object>}
	 */
	this.getCurrentWeather = function () {
		return this.getFeedData().then(data => {
			return Promise.resolve(data.verwachting_vandaag);
		});
	};

	/**
	 * Checks if the location has changed since the last values were cached
	 */
	this.checkLocationChange = function () {
		if (!(this._lat === this.lat && this.lon === this._lon)) {
			this._lat = this.lat;
			this._lon = this.lon;

			this.resetCache();
		}
	};

	/**
	 * resets location dependant cache
	 */
	this.resetCache = function () {
		rainDataCache = null;
		nearestWeatherStationId = null;
	};

}).call(Buienradar.prototype);