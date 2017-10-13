let gulp = require('gulp');
let gutil = require('gulp-util');
let path = require('path');
let fs = require('fs');
let AWS = require('aws-sdk');
let execSync = require('child_process').execSync;

let currentBranch;
if (process.env.CI) { currentBranch = process.env.TRAVIS_BRANCH; }
else {
  currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().replace(/^\s+|\s+$/gm,''); }

let env = process.env.GULP_ENV || process.env.ENV || "development";

let isMasterBranch = ('master'==currentBranch); //|| ('production'==env);
let branchDir = 'branch/'+currentBranch;
if (isMasterBranch) { branchDir = '';}

function getVarForEnv(key, env) {
  return process.env[key+'_'+env.toUpperCase()] ||
    process.env[key+'_'+env.toLowerCase()] ||
    process.env[key+'_'+env]
}

function loadAwsParams() {
  let awsParams;
  if (process.env.CI) {
    gutil.log('using CI config for environment: ' + env);

    awsParams = {
      "region": "",
      "credentials": {
        "accessKeyId": getVarForEnv('AWS_S3_ACCESS_KEYID',env),
        "secretAccessKey": getVarForEnv('AWS_S3_SECRET_ACCESS_KEY',env),
        "signatureVersion": "v3" },
      "params": {"Bucket": getVarForEnv('AWS_S3_BUCKET',env) }
    };
  }
  else {
    console.log("using environment: " + env);
    dotenv_path = "development" === env ? ".env" : ".env." + env;

    if (fs.existsSync(dotenv_path)) {
      Object.assign(process.env, require('dotenv').config({ path: dotenv_path }));
      console.log("dotenv: " + dotenv_path + " loaded");
    } else { console.log("dotenv: " + dotenv_path + " not found, could not load environment"); }

    awsParams = { region: process.env.AWS_REGION,
                  credentials: new AWS.SharedIniFileCredentials(),
                  params: { Bucket: process.env.AWS_S3_BUCKET} };
    gutil.log(awsParams);
  };
  return awsParams;
}

function addDeploymentTasks(files) {
  gulp.task('publish', function() {
    let rename = require('gulp-rename');
    let merge = require('merge-stream');
    let awspublish = require('gulp-awspublish');

    // create a new publisher using S3 options
    // http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property
    let awsParams = loadAwsParams();
    let publisher = awspublish.create(awsParams, { cacheFileName: `awspublish_${env}_${currentBranch}.cache` });

    let negations = files.reverse().slice(0,-1).reduce(
      function(acc, next) {
        newFilter = acc[0].concat(next.filter.map(f => { return '!'+f; }));
        return [newFilter].concat(acc);
      }, [[]]);

    files = files.reverse().map((e,i) => {
      e.filter = e.filter.concat(negations[i]);
      return e;
    });

    let fileGroupPipes = [];
    for (let fileGroup of files) {
      let groupPipe = gulp.src(fileGroup.filter)

      if (!isMasterBranch) {
        groupPipe = groupPipe
          .pipe(rename(function (filepath) {
            filepath.dirname = path.join(branchDir, filepath.dirname);
          })) }

      groupPipe = groupPipe.pipe(publisher.publish(fileGroup.headers));

      fileGroupPipes.push(groupPipe);
    }

    let buildPipe = merge.apply(this, fileGroupPipes)
    if (isMasterBranch) {
      buildPipe = buildPipe.pipe(publisher.sync(branchDir, [ /^branch\/.*\// ] )); }
    else {
      buildPipe = buildPipe.pipe(publisher.sync(branchDir)); }

    buildPipe = buildPipe
      .pipe(publisher.cache())
      .pipe(awspublish.reporter());

    return buildPipe;
  });
}

exports.addDeploymentTasks = addDeploymentTasks;
