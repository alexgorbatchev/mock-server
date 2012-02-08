var async = require('async'),
    campfire = require('./campfire'),
    config = require('./config'),
    express = require('express'),
    log = require('./log');

module.exports = function(app) {
  var branches = [],
      currentBranch;

  app.get('/ms_admin', function(req, res, next) {
    async.parallel([
      function(callback) {
        repo.remoteBranches(function(err, data) {
          branches = data;
          callback(err);
        });
      },
      function(callback) {
        repo.currentBranch(function(err, data) {
          currentBranch = data;
          callback(err);
        });
      }
    ], function(err) {
      res.render('index', {
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
    var target = req.param('target');
    if ((config.projectConfig['build-targets'] || []).indexOf(target) < 0) {
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

    module.exports.pull(currentBranch, function(err) {
      res.redirect('/ms_admin');
    });
  });
};

module.exports.pull = function(currentBranch, callback) {
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

    err || campfire.speak('pulled from ' + currentBranch);
    callback && callback(err);
  });
};
