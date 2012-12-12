var async = require('async'),
    campfire = require('./campfire'),
    config = require('./config'),
    express = require('express'),
    log = require('./log');

module.exports = function(app, repo) {
  var branches = [],
      currentBranch;

  campfire.init(repo);

  app.get('/ms_admin', function(req, res, next) {
    async.parallel([
      function(callback) {
        if (config.isHeroku) {
          repo.remoteBranches(function(err, data) {
            branches = data;
            callback(err);
          });
        } else {
          callback();
        }
      },
      function(callback) {
        if (config.isHeroku) {
          repo.currentBranch(function(err, data) {
            currentBranch = data;
            callback(err);
          });
        } else {
          callback();
        }
      }
    ], function(err) {
      res.render('index', {
        isHeroku: config.isHeroku,
        gitPath: config.appDir,
        mocksEnabled: !!config.mocksEnabled,
        buildTarget: config.buildTarget || {},
        buildTargets: config.projectConfig['build-targets'] || [],
        servers: config.projectConfig.servers || [],
        proxyServer: config.proxyServer,
        branches: branches || [],
        currentBranch: currentBranch,
        log: log.logs, error: log.errors
      });
    });
  });

  app.all('/ms_admin/proxy-server', express.bodyParser(), function(req, res, next) {
    log.reset();

    // Filter the user input
    var proxy = req.param('proxy');
    if ((config.projectConfig.servers || []).indexOf(proxy) < 0) {
      res.redirect('/ms_admin');
      return;
    }

    config.proxyServer = proxy;
    campfire.speak('proxy changed to ' + config.proxyServer);
    res.redirect('/ms_admin');
  });
  app.all('/ms_admin/mocks', express.bodyParser(), function(req, res, next) {
    log.reset();

    config.mocksEnabled = req.param('enable-mocks');
    if (config.mocksEnabled === 'false') {
      config.mocksEnabled = false;
    }
    config.mocksEnabled = !!config.mocksEnabled;

    campfire.speak('mocksEnabled changed to ' + config.mocksEnabled);
    res.redirect('/ms_admin');
  });
  app.all('/ms_admin/build-target', express.bodyParser(), function(req, res, next) {
    log.reset();

    // Filter the input
    var target = parseInt(req.param('target'));
    if (target < 0 || (config.projectConfig['build-targets'] || []).length <= target) {
      res.redirect('/ms_admin');
      return;
    }

    config.buildTarget = target;
    repo.build(function() {
      campfire.speak('build target changed to ' + config.buildTarget.name);
      res.redirect('/ms_admin');
    });
  });
  app.all('/ms_admin/branch', express.bodyParser(), function(req, res, next) {
    log.reset();

    // Filter the input
    var branch = req.param('branch'),
        sameBranch = currentBranch === branch;
    console.log('branch', branch, branches, branches.indexOf(branch));
    if (branches.indexOf(branch) < 0) {
      res.redirect('/ms_admin');
      return;
    }

    console.log('Switching to branch', branch);
    async.series([
      function(callback) {
        // Skip checkout if we are already on this branch
        if (sameBranch) {
          callback();
        } else {
          repo.checkout(branch, callback);
        }
      },
      function(callback) {
        repo.pull(!sameBranch, function(err) {
          callback(err);
        });
      },
      function(callback) {
        repo.build(callback);
      }
    ],
    function(err) {
      err || campfire.speak('branch changed to ' + branch);
      res.redirect('/ms_admin');
    });
  });
  app.all('/ms_admin/pull', express.bodyParser(), function(req, res, next) {
    log.reset();

    module.exports.pull(repo, currentBranch, function(err) {
      res.redirect('/ms_admin');
    });
  });
};

module.exports.pull = function(repo, currentBranch, callback) {
  log.reset();

  async.series([
    function(callback) {
      repo.pull(callback);
    },
    function(callback) {
      repo.build(callback);
    }
  ],
  function(err) {
    if (err) {
      log.exception(err);
    }

    err || process.env.CAMPFIRE_QUIET || campfire.speak('pulled from ' + currentBranch);
    callback && callback(err);
  });
};
