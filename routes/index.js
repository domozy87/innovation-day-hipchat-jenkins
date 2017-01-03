var http = require('request');
var cors = require('cors');
var uuid = require('uuid');
var url = require('url');
var redis = require('atlassian-connect-express-redis');
var _ = require('lodash');
var jenkins = undefined;

// This is the heart of your HipChat Connect add-on. For more information,
// take a look at https://developer.atlassian.com/hipchat/tutorials/getting-started-with-atlassian-connect-express-node-js
module.exports = function (app, addon) {
	var hipchat = require('../lib/hipchat')(addon);
	var custom = require('../lib/custom')(addon);

	// simple healthcheck
	app.get('/healthcheck', function (req, res) {
		res.send('OK');
	});

	// Root route. This route will serve the `addon.json` unless a homepage URL is
	// specified in `addon.json`.
	app.get('/',
		function (req, res) {
			// Use content-type negotiation to choose the best way to respond
			res.format({
				// If the request content-type is text-html, it will decide which to serve up
				'text/html': function () {
					var homepage = url.parse(addon.descriptor.links.homepage);
					if (homepage.hostname === req.hostname && homepage.path === req.path) {
						res.render('homepage', addon.descriptor);
					} else {
						res.redirect(addon.descriptor.links.homepage);
					}
				},
				// This logic is here to make sure that the `addon.json` is always
				// served up when requested by the host
				'application/json': function () {
					res.redirect('/atlassian-connect.json');
				}
			});
		}
	);

	// This is an example route that's used by the default for the configuration page
	// https://developer.atlassian.com/hipchat/guide/configuration-page
	app.get('/config',
		// Authenticates the request using the JWT token in the request
		addon.authenticate(),
		function (req, res) {
			// The `addon.authenticate()` middleware populates the following:
			// * req.clientInfo: useful information about the add-on client such as the
			//   clientKey, oauth info, and HipChat account info
			// * req.context: contains the context data accompanying the request like
			//   the roomId

			var key = custom.generateIdentifier(req);
			addon.settings.get('projectName', key).then(function (name) {

				if (!name) {
					res.render('config', {});
					return;
				}

				//remove the need for the user to type /All in, handle that in the background
				name = name.replace('/All', '');

				res.render('config', {
					projectName: name
				});
			});
		}
	);

	// This is an example glance that shows in the sidebar
	// https://developer.atlassian.com/hipchat/guide/glances
	app.get('/glance',
		cors(),
		addon.authenticate(),
		function (req, res) {
			res.json({
				"label": {
					"type": "html",
					"value": "CI Status"
				}
			});
		}
	);

	// This is an example sidebar controller that can be launched when clicking on the glance.
	// https://developer.atlassian.com/hipchat/guide/dialog-and-sidebar-views/sidebar
	app.get('/sidebar',
		addon.authenticate(),
		function (req, res) {
			addon.settings.get('projectName', custom.generateIdentifier(req)).then(function (projectname) {
				if (projectname) {
					var project = custom.getProjectName(projectname);
					jenkins = custom.getJenkins(req);
					jenkins.view.exists(project, function (err, exists) {
						if (err) {
							res.render('sidebar', {
								identity: req.identity,
								projectName: custom.getMessage('failed-sidebar')
							});
							return;
						}
						if (exists) {
							jenkins.view.get(project, function (err, data) {
								if (err) {
									res.render('sidebar', {
										identity: req.identity,
										projectName: custom.getMessage('failed-sidebar')
									});
									return;
								}

								//only get the freestyle jobs for now
								var freestyleJobs = _.filter(data.jobs, ['_class', 'hudson.model.FreeStyleProject']);

								//change the colours of the job status, as Jenkins defaults are shit
								_.forEach(freestyleJobs, function (value, key) {
									var statusColor = custom.getColorByStatus(value.color, 2);
									value.color = statusColor['color'];
								});
								res.render('sidebar', {
									identity: req.identity,
									jobs: freestyleJobs,
									projectName: projectname
								});
							});
						}
					});
				}
			});
		}
	);

	app.post('/configure-project-name',
		addon.authenticate(),
		function (req, res) {
			var key = custom.generateIdentifier(req);
			var projectName = req.body['projectname'];

			addon.settings.set('projectName', projectName, key).then(function () {
				res.redirect('/config?signed_request=' + req.query['signed_request']);
			});
		}
	);

	// This is an example dialog controller that can be launched when clicking on the glance.
	// https://developer.atlassian.com/hipchat/guide/dialog-and-sidebar-views/dialog
	app.get('/dialog',
		addon.authenticate(),
		function (req, res) {
			res.render('dialog', {
				identity: req.identity
			});
		}
	);

	// Sample endpoint to send a card notification back into the chat room
	// See https://developer.atlassian.com/hipchat/guide/sending-messages
	app.post('/send_notification',
		addon.authenticate(),
		function (req, res) {
			var card = {
				"style": "link",
				"url": "https://www.hipchat.com",
				"id": uuid.v4(),
				"title": req.body.messageTitle,
				"description": "Great teams use HipChat: Group and private chat, file sharing, and integrations",
				"icon": {
					"url": "https://hipchat-public-m5.atlassian.com/assets/img/hipchat/bookmark-icons/favicon-192x192.png"
				}
			};
			var msg = '<b>' + card.title + '</b>: ' + card.description;
			var opts = {'options': {'color': 'yellow'}};
			hipchat.sendMessage(req.clientInfo, req.identity.roomId, msg, opts, card);
			res.json({status: "ok"});
		}
	);

	// This is an example route to handle an incoming webhook
	// https://developer.atlassian.com/hipchat/guide/webhooks
	app.post('/hi',
		addon.authenticate(),
		function (req, res) {

			if (req.body.event === "room_message") {
				var username = req.body.item.message.from.mention_name;
				hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Hello ' + username)
					.then(function (data) {
						res.sendStatus(200);
					});
			}
		});

	// This is an example route to handle an incoming webhook
	// https://developer.atlassian.com/hipchat/guide/webhooks
	app.post('/hello',
		addon.authenticate(),
		function (req, res) {
			if (req.body.event === "room_message") {
				var username = req.body.item.message.from.mention_name;
				hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Hi ' + username)
					.then(function (data) {
						res.sendStatus(200);
					});
			}
		});

	// function to build project
	// to be used in both /build and /deploy
	var buildProject = function (req, jenkins, projectname, username) {
		jenkins.job.exists(projectname, function (err, exists) {
			if (exists) {
				jenkins.job.build(projectname + custom.build, function (err, data) {
					if (err) {
						custom.sendMessage(req, custom.getMessage('failed-project', projectname), custom.failColor);
						return;
					}
					custom.sendMessage(req, custom.getMessage('triggered-project',projectname, data, username), custom.successColor);
				});
			} else {
				custom.sendMessage(req, custom.getMessage('no-project', projectname), custom.failColor);
			}
		});
	};

	// command /ci build project_name
	app.post('/build',
		addon.authenticate(),
		function (req, res) {
			if (req.body.event === "room_message") {
				var username = custom.getUserName(req);
				var projectname = custom.getCleanInput('build', req.body.item.message.message);
				if (projectname) {
					if (custom.checkJenkinsUser(username)) {
						jenkins = custom.getJenkins(req, username);
						buildProject(req, jenkins, projectname, username);
					} else {
						custom.sendMessage(req, custom.getMessage('denied-permission', username), custom.failColor);
					}
				} else {
					custom.sendMessage(req, custom.getMessage('invalid-project', projectname), custom.failColor);
				}
			}
		});

	// command /ci deploy project_name/job_name
	app.post('/deploy',
		addon.authenticate(),
		function (req, res) {
			if (req.body.event === "room_message") {
				var username = custom.getUserName(req);
				var projectpath = custom.getCleanInput('deploy', req.body.item.message.message).split('/');
				var projectname = projectpath[0] == undefined? null : projectpath[0];
				var jobname = projectpath[1] == undefined? null : projectpath[1];

				if (!projectname) {
					custom.sendMessage(req, custom.getMessage('invalid-project', projectname), custom.failColor);
					return;
				}

				jenkins = custom.getJenkins(req, username);
				if (!jobname) {
					buildProject(req, jenkins, projectname, username);
					return;
				} else if (jobname !== 'demo' && jobname !== 'live') {
					custom.sendMessage(req, custom.getMessage('denied-command', projectname), custom.failColor);
					return;
				}

				jenkins.view.exists(projectname + custom.pipeline, function (err, exists) {
					if (!exists) {
						custom.sendMessage(req, custom.getMessage('no-pipeline', projectname), custom.failColor);
						return;
					}
					// Read the build job
					jenkins.job.get(projectname + custom.build, function(err, pipeline_build_job) {
						if (pipeline_build_job.lastBuild === null) {
							custom.sendMessage(req, custom.getMessage('denied-deploy', jobname), custom.failColor);
							return;
						}
						// Get Parameters for deployment
						var pipeline_build_number = pipeline_build_job.lastBuild.number;
						jenkins.job.get(projectname + custom.deploy + custom.upstream[jobname], function (err, pipeline_latest_job) {
							if (err) {
								custom.sendMessage(req, custom.getMessage('failed-deploy', projectname, jobname), custom.failColor);
								return;
							}
							if (pipeline_latest_job.lastBuild === null) {
								custom.sendMessage(req, custom.getMessage('denied-deploy', jobname), custom.failColor);
								return;
							}
							var pipeline_latest_number = pipeline_latest_job.lastBuild.number;
							jenkins.build.get(
								projectname + custom.deploy + custom.upstream[jobname],
								pipeline_latest_number,
								function(err, pipeline_latest_build) {
									var parameter = _.find(pipeline_latest_build.actions, ['_class', 'hudson.model.ParametersAction']);
									var deploy_id = _.find(parameter.parameters, ['name', 'DEPLOY_ID']);

									if (deploy_id.value != pipeline_build_number) {
										custom.sendMessage(req, custom.getMessage('denied-deploy', jobname), custom.failColor);
										return;
									}
									var git_commit = _.find(parameter.parameters, ['name', 'GIT_COMMIT']);
									var build_options = {
										parameters: {
											GIT_COMMIT: git_commit.value,
											DEPLOY_ID: deploy_id.value
										}
									};
									jenkins.job.build(projectname + custom.deploy + jobname,
										build_options,
										function (err, data) {
											custom.sendMessage(req, custom.getMessage('triggered-deploy', projectname, jobname), custom.successColor);
										});
								});
						});
					});
				});
			}
		});

	// command /ci status project_name/job_name
	app.post('/status',
		addon.authenticate(),
		function (req, res) {
			if (req.body.event === "room_message") {
				var username = custom.getUserName(req);
				var job_name = custom.getCleanInput('status', req.body.item.message.message);
				if (job_name) {
					jenkins = custom.getJenkins(req, username);
					jenkins.job.exists(job_name, function (err, exists) {
						if (exists) {
							jenkins.job.get(job_name, function (err, data) {
								if (err) {
									custom.sendMessage(req, custom.getMessage('invalid-job', job_name), custom.failColor);
									return;
								}
								var status = custom.getColorByStatus(data.color);
								custom.sendMessage(req, custom.getMessage('status', job_name, status['status']), status['color']);
							});
						} else {
							custom.sendMessage(req, custom.getMessage('no-job', job_name), custom.failColor);
						}
					});
				} else {
					custom.sendMessage(req, custom.getMessage('invalid-job', job_name), custom.failColor);
				}
			}
		});

	// Notify the room that the add-on was installed. To learn more about
	// Connect's install flow, check out:
	// https://developer.atlassian.com/hipchat/guide/installation-flow
	addon.on('installed', function (clientKey, clientInfo, req) {
		hipchat.sendMessage(clientInfo, req.body.roomId, 'The ' + addon.descriptor.name + ' add-on has been installed in this room');
	});

	// Clean up clients when uninstalled
	addon.on('uninstalled', function (id) {
		addon.settings.client.keys(id + ':*', function (err, rep) {
			rep.forEach(function (k) {
				addon.logger.info('Removing key:', k);
				addon.settings.client.del(k);
			});
		});
	});

};
