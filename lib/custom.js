var RSVP = require('rsvp');
var http = require('request');
var _ = require('lodash');

module.exports = function (addon) {
	var jenkinsToken = require('../jenkinsToken');
	var hipchat = require('../lib/hipchat')(addon);

	var jenkinsBaseUrl = {
		username: '',
		token: '',
		domain: '@ci.web-essentials.asia'
	};
	var COLORS = {
		'gray': 'gray',
		'green': 'green',
		'blue': 'blue',
		'yellow': 'yellow',
		'red': 'red',
		'purple': 'purple'
	};
	var DELIMITER = '.';

	function request(clientInfo, options) {

		return new RSVP.Promise(function (resolve, reject) {

			function makeRequest(clientInfo) {
				addon.getAccessToken(clientInfo).then(function (token) {
					var hipchatBaseUrl = clientInfo.capabilitiesDoc.links.api;
					http({
						method: options.method || 'GET',
						url: hipchatBaseUrl + options.resource,
						qs: _.extend({auth_token: token.access_token}, options.qs),
						body: options.body,
						json: true
					}, function (err, resp, body) {
						if (err || (body && body.error)) {
							reject(err || body.error.message);
							return;
						}
						resolve(resp);
					});
				});
			}

			if (!clientInfo) {
				reject(new Error('clientInfo not available'));
				return;
			}
			if (typeof clientInfo === 'object') {
				makeRequest(clientInfo);
			} else {
				addon.loadClientInfo(clientInfo).then(makeRequest);
			}

		});

	}

	function fail(response, reject) {
		var code = response.statusCode;
		var msg = 'Unexpected response: [' + code + '] ' + require('http').STATUS_CODES[code];
		var err = new Error(msg);
		err.response = response;
		reject(err);
	}

	return {

		defaultColor: 'yellow',
		failColor: 'red',
		successColor: 'green',
		build: '/build',
		pipeline: '/pipeline',
		deploylatest: '/deploy-latest',
		deploy: '/deploy-',
		upstream: {'demo': 'latest', 'live': 'demo'},
		getColorByStatus: function (status, color_index) {
			console.log('72: ' + status);
			if (status == undefined) {
				return {
					'code': 'red',
					'status': 'Failed to find the Job',
					'color': 'red'
				};
			}
			var statuses = {
				'notbuilt': ['No Built', 'gray', '#f5f5f5'],
				'disabled': ['Disabled', 'gray', '#707070'],
				'blue': ['Successful', 'green', '#14892c'],
				'blue_anime': ['In Progress', 'blue', 'yellow'],
				'yellow': ['Unstable', 'yellow', 'orange'],
				'red': ['Failed', 'red', 'red'],
				'aborted': ['Aborted', 'purple', 'brown']
			};
			if (color_index == undefined || statuses[status][color_index] == undefined || color_index < 1) {
				color_index = 1;
			}
			return {
				'code': status,
				'status': statuses[status][0],
				'color': statuses[status][color_index]
			};
		},
		getJenkins: function (req, username) {
			if (username == undefined || username == '') {
				username = 'oudom';
			}
			if (jenkinsBaseUrl.username == '' || jenkinsBaseUrl.token == '') {
				if(!this.checkJenkinsUser(username)) {
					throw this.getMessage('failed-auth');
				}
			}
			var jenkinsObject = require('jenkins')({
				baseUrl: 'https://' + jenkinsBaseUrl.username + ':' + jenkinsBaseUrl.token + jenkinsBaseUrl.domain
			});
			return jenkinsObject;
		},
		generateIdentifier: function (req) {
			return req.clientInfo.clientKey.concat(DELIMITER).concat(req.clientInfo.roomId.toString());
		},
		getProjectName: function (name) {
			return name + '/All';
		},
		getCleanProjectName: function (name) {
			return name.replace('/All', '');
		},
		getCleanInput: function (input, message) {
			message = message.toLowerCase();
			switch (input) {
				case 'deploy':
					return message.replace(/^\/ci deploy /, '');
					break;
				case 'build':
					return message.replace(/^\/ci build /, '');
					break;
				case 'status':
					return message.replace(/^\/ci status /, '');
					break;
				default:
					return '';
					break;
			}
		},
		sendMessage: function (req, msg, color) {
			var opts = {'options': {'color': this.defaultColor, 'message_format': 'html', 'notify': 'false'}};
			if (color !== undefined) {
				opts['options']['color'] = color;
			}
			this.throwIfMessageEmpty(msg);
			hipchat.sendMessage(req.clientInfo, req.identity.roomId, msg, opts)
				.then(function (data) {
					res.sendStatus(200);
				});
		},
		getMessage: function (type, param1, param2, param3) {
			var err = 'Error Occured';
			var msg;
			switch (type) {
				case undefined:
				case 'err':
					msg = err;
					break;
				case 'no-job':
					msg = 'Job <' + param1 + '> Does Not Exist';
					break;
				case 'no-project':
					msg = 'Project <' + param1 + '> Does Not Exist';
					break;
				case 'no-pipeline':
					msg = 'Pipeline <' + param1 + '> Does Not Exist';
					break;
				case 'invalid-job':
					msg = 'Job <' + param1 + '> Is Invalid';
					break;
				case 'invalid-project':
					msg = 'Project <' + param1 + '> Is Invalid';
					break;
				case 'failed-job':
					msg = 'Failed To Build Job <' + param1 + '>';
					break;
				case 'failed-project':
					msg = 'Failed To Build Project <' + param1 + '>';
					break;
				case 'failed-deploy':
					msg = 'Failed To Deploy Project <' + param1 + '> To <' + param2+ '>';
					break;
				case 'failed-auth':
					msg = 'Failed To Authenticate User';
					break;
				case 'failed-sidebar':
					msg = '[Failed To Load Data]';
					break;
				case 'triggered-job':
					msg = 'Job: ' + param1 + '<br>' +
						'Build: ' + param2 + '<br>' +
						'Status: Build Successfully Triggered' + '<br>' +
						'By User: ' + param3;
					break;
				case 'triggered-project':
					msg = 'Project: ' + param1 + '<br>' +
						'Build: ' + param2 + '<br>' +
						'Status: Build Successfully Triggered' + '<br>' +
						'By User: ' + param3;
					break;
				case 'triggered-pipeline':
					msg = 'Project: ' + param1 + '<br>' +
						'Status: Pipeline Build Successfully Triggered' + '<br>' +
						'By User: ' + param2;
					break;
				case 'triggered-deploy':
					msg = 'Project: ' + param1 + ' Deployment to <' + param2 + '> has been successfully triggered!';
					break;
				case 'status':
					msg = 'Job: <strong>' + param1 + '</strong><br>' +
						'Status: <strong>' + param2 + '</strong>';
					break;
				case 'denied-permission':
					msg = 'Permission Denied For This User <' + param1+ '>';
					break;
				case 'denied-command':
					msg = 'Command not allowed. Please use <' + project_name + '/demo> or <' + project_name + '/live>!';
					break;
				case 'denied-deploy':
					msg = 'Cannot deploy to <'+ param1+'>. Please execute the pipeline build first!';
					break;
				default:
					break;
			}
			return msg;
		},
		throwIfMessageEmpty: function (msg) {
			if(msg == undefined || msg == '') {
				throw 'Error: Message Not Supplied';
			}
		},
		validateMessageColor: function (color) {
			if (COLORS[color] == undefined) {
				return this.defaultColor;
			}
			return color;
		},
		checkJenkinsUser: function (username) {
			var tokens = jenkinsToken.token;
			for (var i = 0; i < tokens.length; i++) {
				if (tokens[i].username.toLowerCase() == username.toLowerCase()) {
					jenkinsBaseUrl.username = username;
					jenkinsBaseUrl.token = tokens[i].token;
					return true;
				}
			}
			return false;
		},
		getUserName: function (req) {
			// TODO: get email from body message, then modify this.getJenkins()
			return req.body.item.message.from.mention_name;
		}
	}
};
