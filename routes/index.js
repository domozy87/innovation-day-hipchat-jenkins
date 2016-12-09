var http = require('request');
var cors = require('cors');
var uuid = require('uuid');
var url = require('url');
var redis = require('atlassian-connect-express-redis');
var _ = require('lodash');
var jenkins = require('jenkins')({
	baseUrl: 'https://stoplight:Pass0n16Dec2013@ci.web-essentials.asia'
});

// This is the heart of your HipChat Connect add-on. For more information,
// take a look at https://developer.atlassian.com/hipchat/tutorials/getting-started-with-atlassian-connect-express-node-js
module.exports = function (app, addon) {
	var hipchat = require('../lib/hipchat')(addon);

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




			res.render('config', req.context);
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
        // ,
				// "status": {
				// 	"type": "lozenge",
				// 	"value": {
				// 		"label": "NEW",
				// 		"type": "error"
				// 	}
				// }
			});
		}
	);

	// This is an example end-point that you can POST to to update the glance info
	// Room update API: https://www.hipchat.com/docs/apiv2/method/room_addon_ui_update
	// Group update API: https://www.hipchat.com/docs/apiv2/method/addon_ui_update
	// User update API: https://www.hipchat.com/docs/apiv2/method/user_addon_ui_update
	// app.post('/update_glance',
	// 	cors(),
	// 	addon.authenticate(),
	// 	function (req, res) {
	// 		res.json({
	// 			"label": {
	// 				"type": "html",
	// 				"value": "Hello World!"
	// 			},
	// 			"status": {
	// 				"type": "lozenge",
	// 				"value": {
	// 					"label": "All good",
	// 					"type": "success"
	// 				}
	// 			}
	// 		});
	// 	}
	// );

	// This is an example sidebar controller that can be launched when clicking on the glance.
	// https://developer.atlassian.com/hipchat/guide/dialog-and-sidebar-views/sidebar
	app.get('/sidebar',
		addon.authenticate(),
		function (req, res) {
      var view_name = '014-701-we-infrastructure/All';

      if (view_name) {
          jenkins.view.exists(view_name, function(err, exists) {
              if (exists) {
                  jenkins.view.get(view_name, function (err, data) {
                      if (err) throw err;

                      //only get the freestyle jobs for now
                      var freestyleJobs = _.filter(data.jobs, ['_class', 'hudson.model.FreeStyleProject']);

                      //change the colours of the job status, as Jenkins defaults are shit
                      _.forEach(freestyleJobs, function(value, key){
                          if(value.color === 'blue'){
                            value.color = '#14892c';
                          } else if (value.color === 'notbuilt'){
                            value.color = '#f5f5f5'
                          } else if (value.color === 'red'){
                            value.color = '#d04437'
                          } else if (value.color === 'disabled'){
                            value.color = '#707070'
                          }
                      });

                      //render the sidebar
                      res.render('sidebar', {
                          identity: req.identity,
                          jobs: freestyleJobs
                      });
                  });
              } else {
                  console.log('view does not exist');
              }
          });
      } else {
		console.log('view name wasn\'t supplied');
      }
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

  // This is an example route to handle an incoming webhook
  // https://developer.atlassian.com/hipchat/guide/webhooks
  app.post('/build',
    addon.authenticate(),
    function (req, res) {

      if (req.body.event === "room_message") {
        var username = req.body.item.message.from.mention_name;
        var message = req.body.item.message.message;
        var job_name = message.replace(/^\/ci build /, '');
        var color = 'red';
        if (job_name) {
          jenkins.job.exists(job_name, function (err, exists) {
            if (exists) {
              jenkins.job.build(job_name, function (err, data) {
                if (err) throw err;
                console.log('queue item number', data);
                color = 'green'
                var opts = {'options': {'color': color, 'message_format': 'html', 'notify': 'false'}};
                hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Job name <' + job_name + '> has been successfully triggered by <' + username + '>', opts)
                  .then(function (data) {
                    res.sendStatus(200);
                  });
              });
            } else {
              var opts = {'options': {'color': color, 'message_format': 'html', 'notify': 'false'}};
              hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Job name <' + job_name + '> does not exist.', opts)
                .then(function (data) {
                  res.sendStatus(200);
                });
            }
          });
        } else {
          var opts = {'options': {'color': color, 'message_format': 'html', 'notify': 'false'}};
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Job name <' + job_name + '> is invalid.', opts)
            .then(function (data) {
              res.sendStatus(200);
            });
        }
      }
    });

  // This is an example route to handle an incoming webhook
  // https://developer.atlassian.com/hipchat/guide/webhooks
  app.post('/deploy',
    addon.authenticate(),
    function (req, res) {

      if (req.body.event === "room_message") {
        var message = req.body.item.message.message;
        var project_name = message.replace(/^\/ci deploy /, '');

        jenkins.view.exists(project_name + '/pipeline', function (err, exists) {
          if (err) throw err;
          if (exists) {
            jenkins.job.build(project_name + '/build', function (err, data) {
              if (err) throw err;
              console.log('queue item number', data);
              hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Pipeline build for project <' + project_name + '> has been successfully triggered!')
                .then(function (data) {
                  res.sendStatus(200);
                });
            });
          } else {
            hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Pipeline for <' + project_name + '> does not exist!')
              .then(function (data) {
                res.sendStatus(200);
              });
          }
        });
      }
    });

	app.post('/status',
		addon.authenticate(),
		function (req, res) {
			var message = req.body.item.message.message.toLowerCase();
			var job_name = message.replace(/^\/ci status /, '');

			if (job_name) {
				jenkins.job.exists(job_name, function (err, exists) {
					if (exists) {
						jenkins.job.get(job_name, function (err, data) {

							var buildStatus = {
								'red': 'Failed',
								'green': 'Successful',
								'yellow': 'In Progress',
								'grey': 'Not Built'
								};
							if (data.color == 'blue') {
								data.color = 'green';
							}

							var opts = {'options': {'color': data.color, 'message_format': 'html', 'notify': 'false'}};

							hipchat.sendMessage(
								req.clientInfo,
								req.identity.roomId,
								'Status: <strong>' + buildStatus[data.color] + '</strong>',
								opts )
								.then(function (data) {
									res.sendStatus(200);
								});
						});
					} else {
						hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Job name <' + job_name + '> does not exist.')
							.then(function (data) {
								res.sendStatus(200);
							});
					}
				});
			} else {
				hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Job name <' + job_name + '> is invalid.')
					.then(function (data) {
						res.sendStatus(200);
					});
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
