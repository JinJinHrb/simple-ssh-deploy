/* eslint-disable arrow-parens */
// import Path from 'path'
// import fs from 'fs'
// import Q from 'q';
// // import zipFolder from 'zip-folder';
// import archiver from 'archiver'
// import _L from 'lodash';
// import hdlUtil from './helpers/hdlUtil';
// import fsUtil from './helpers/fsUtil';
// import { NodeSSH } from 'node-ssh'

const Path = require('path');
const fs = require('fs');
const Q = require('q');
const archiver = require('archiver');
// const _L = require('lodash');
const hdlUtil = require('./helpers/hdlUtil');
const fsUtil = require('./helpers/fsUtil');
// const { NodeSSH } = require('node-ssh');
// https://www.npmjs.com/package/ssh2-sftp-client
const Ssh2SftpClient = require('ssh2-sftp-client');

const _defaultInitScript = [
    '#!/bin/bash',
    '# author: WangFan',
    '# description: backup server directory',
    'time1=$(date +"%Y-%m-%dT%H-%M-%S")',
    'str1=\'server.\'',
    'str2=\'改前.tar.gz\'',
    'time2=$str1$time1$str2',
    'tar -czvf $time2 server &&',
    'unzip -o server.zip -d ${destFolderPath} &&',
    'sleep 2 &&',
    'rm -f server.zip &',
    'nohup forever stop index.js &',
    'forever start -o nohup.out -e nohup.out index.js'
    ].join('\n');

class Deploy {
    constructor (args = {}) {
        const mandatoryFields = ['author', 'srcFolderPath']; // 'destFolderPath', 'host', 'username'
        // const mandatoryOneFields = ['privateKeyPath', 'password']
        // const optionalFields = ['initScript', modifiedHours];
        for(let fd of mandatoryFields){
            if(!hdlUtil.getDeepVal(args, fd)){
                throw new Error(`mandatory field "${fd}" is missing`);
            }
        }
        /* let isMandatoryOneOk = false; // 二选一
        for(let fd of mandatoryOneFields){
            if(hdlUtil.getDeepVal(args, fd)){
                isMandatoryOneOk = true;
                break;
            }
        }
        if(!isMandatoryOneOk){
            throw new Error(`mandatory field "privateKeyPath / password" is missing`);
        } */
        this.args = args;
    }

    getInitScriptPromise ({leafFolderName, destFolderPath}) {
        if ( this.args.initScript ) {
            return Q.resolve(this.args.initScript);
        }
        // const destFolderPath = this.args.destFolderPath;
        const author = this.args.author;
        return Q.promise((rsv/* , rej */) => {
            /* const bashFilePath = Path.resolve(__dirname, 'helpers/backupServer.sh');
            fs.readFile(bashFilePath, 'utf8', (err, rst) => {
                if (err) {
                    return rej(err);
                } */
                let rst = _defaultInitScript;
                if(author){
                    const regex2 = new RegExp('改前');
                    rst = rst.replace(regex2, `.${author}.backup`);
                }
                rst = rst.replace(/\$\{destFolderPath\}/g, destFolderPath);
                if(!leafFolderName || leafFolderName === 'server'){
                    return rsv(rst);
                }else{
                    const regex = new RegExp('server', 'g');
                    rst = rst.replace(regex, leafFolderName);
                    rsv(rst);
                }
            // })
        })
    }

    removeFilePromise (filePath) {
        return Q.promise((rsv/* , rej */) => {
            // eslint-disable-next-line no-sync
            if (!fs.existsSync(filePath)) {
                return rsv(`removeFilePromise #111 not found: ${filePath}`);
            }
            fs.unlink(filePath, function (err) {
                if (err) {
                    console.error('removefilePromise #27', err);
                }
                rsv(filePath);
            });
        })
    }

    removeFolderPromise (folerPath) {
        return Q.promise((rsv, rej) => {
            // delete directory recursively
            fs.rmdir(folerPath, { recursive: true }, (err) => {
                if (err) {
                    console.error(`fail to delete ${folerPath}, ERROR:`, err);
                    rej(err);
                }else{
                    console.log(hdlUtil.date2string(new Date(), 'ms'), `#268 ${folerPath} is deleted!`);
                    rsv(null);
                }
            });
        })
    }
    
    /** 
     * @param {String} folderPath the path of folder to be zipped
     * @param {String} options options.deleteFolder Y 压缩后删除文件 
     * @returns {String} zipPath
     * */
    // zipFolderHandler (folderPath, options = {}) {
    //     if (_L.endsWith(folderPath, Path.sep)) {
    //         folderPath = folderPath.slice(0, folderPath.length - 1);
    //     }
    //     const zipPath = _L.trim(hdlUtil.getDeepVal(options, 'zipPath') || `${folderPath}.zip`);
    //     return Q.promise(function (rsv, rej) {
    //         // eslint-disable-next-line no-sync
    //         if (!fs.existsSync(folderPath)) {
    //             return rsv({ code: 113 });
    //         }
    //         zipFolder(folderPath, zipPath, err => {
    //             if (err) {
    //                 rej(err)
    //             } else {
    //                 rsv({ code: 111, zipPath });
    //             }
    //         });
    //     });
    // }

    /**
     * 压缩文件夹
     */
    archiveFolderPromise(folderPath, targetPath){
        return Q.promise((rsv, rej) => {
            let promiseReturned = false;
            if(!fs.existsSync(folderPath)){
                return rej({code: 110, msg: `folderPath not exists: ${folderPath}`});
            }
            /*
                stats.isFile()
                stats.isDirectory()
                stats.isBlockDevice()
                stats.isCharacterDevice()
                stats.isSymbolicLink() (only valid with fs.lstat())
                stats.isFIFO()
                stats.isSocket()
            */
            if(!fs.lstatSync(folderPath).isDirectory()){
                return rej({code: 110, msg: `folderPath is not of folder: ${folderPath}`});
            }
            if(!targetPath){
                targetPath = `${folderPath}.zip`; // Zip 文件不带.开头
            }
            
            // create a file to stream archive data to.
            const output = fs.createWriteStream(targetPath);
            const archive = archiver('zip', {
                zlib: { level: 9 } // Sets the compression level.
            });

            // listen for all archive data to be written
            // 'close' event is fired only when a file descriptor is involved
            output.on('close', function() {
                console.log(archive.pointer() + ' total bytes');
                console.log('archiver has been finalized and the output file descriptor has closed.');
                if(promiseReturned){
                    return;
                }
                promiseReturned = true;
                rsv({sourcePath: folderPath, targetPath});
            });

            output.on('end', function() {
                console.log('Data has been drained');
                // if(promiseReturned){
                //     return;
                // }
                // promiseReturned = true;
                // rsv({sourcePath: folderPath, targetPath});
            });

            // good practice to catch this error explicitly
            archive.on('error', function(err) {
                // throw err;
                if(promiseReturned){
                    return;
                }
                promiseReturned = true;
                rej(err);
            });

            // pipe archive data to the file
            archive.pipe(output);

            archive.bulk([
                { expand: true, cwd: folderPath, src: ['**/*'] }
            ]).finalize();

            archive.finalize();
        })
    }

    exec () {
        const { srcFolderPath, modifiedHours } = this.args;
        let servers = this.args.servers;
        if(!servers){
            const {destFolderPath, privateKeyPath, host, port, username, password} = this.args;
            servers = [{destFolderPath, privateKeyPath, host, port, username, password}];
        }
        const _this = this;
        const recur = (feed = {}) => {
            const {tmpFolderPath, localBashFilePath, zipPath} = feed;
            if(servers.length < 1){
                const qAll = [];
                qAll.push( this.removeFilePromise(zipPath) );
                qAll.push( this.removeFilePromise(localBashFilePath) );
                qAll.push( this.removeFolderPromise(tmpFolderPath) );
                return;
            }
            const task = Object.assign({}, servers.shift(), {srcFolderPath, modifiedHours});
            if(zipPath){
                task.preparedZipPath = zipPath;
                task.preparedTmpFolderPath = tmpFolderPath;
            }
            _this.exec2(task).then(recur);
        }
        recur();
    }

    exec2 (params = {}) {
        const { srcFolderPath, modifiedHours, destFolderPath, privateKeyPath, host, port = 22, username, password } = params;
        const preparedZipPath = params.preparedZipPath; // 同一批部署，不重复制作压缩包
        const preparedTmpFolderPath = params.preparedTmpFolderPath; // 同一批部署，不重复制作压缩包
        let tmpFolderPath; // if modifiedHours, copy selected files to ${tmpFolderPath} first
        let lastSlashIdx = srcFolderPath.lastIndexOf(Path.sep);
        if (lastSlashIdx === srcFolderPath.length - 1) {
            lastSlashIdx = srcFolderPath.slice(0, -1).lastIndexOf(Path.sep);
        }

        let leafFolderName = srcFolderPath.slice(lastSlashIdx + 1);
        if(hdlUtil.endsWith(leafFolderName, Path.sep)){
            leafFolderName = leafFolderName.slice(0, leafFolderName.length - 1);
        }
        const zipFileName = `${leafFolderName}.zip`;

        const parentFolderPath = srcFolderPath.slice(0, lastSlashIdx);
        const zipPath = Path.resolve(parentFolderPath, zipFileName);

        let destPathSep;
        if(destFolderPath.indexOf('/') !== 0 || destFolderPath.slice(0, 4).indexOf(':') > 0){
            destPathSep = '\\';
        }else{
            destPathSep = '/';
        }
        lastSlashIdx = destFolderPath.lastIndexOf(destPathSep);
        if (lastSlashIdx === destFolderPath.length - 1) {
            lastSlashIdx = destFolderPath.slice(0, -1).lastIndexOf(destPathSep);
        }
        const parentDestFolderPath = destFolderPath.slice(0, lastSlashIdx);
        const destFilePath = `${parentDestFolderPath}${destPathSep}${zipFileName}`; // Path.resolve(parentDestFolderPath, zipFileName);
        const localBashFilePath = Path.resolve(__dirname, '.backupServer.sh');
        let sshClient/* , toPrint */;
        return Q.promise((rsvRoot/* , rejRoot */) => {
            (() => {
                // eslint-disable-next-line no-sync
                if(fs.existsSync(zipPath) && !preparedZipPath){ // 不删除同一批任务留下的压缩包
                    return this.removeFilePromise (zipPath);
                }else{
                    return Q.resolve(null);
                }
            })().then(() => {
                if(hdlUtil.oType(modifiedHours) === 'number'){
                    if(preparedZipPath && fs.existsSync(zipPath)){ // 不重复制作压缩包
                        return preparedTmpFolderPath;
                    }
                    return fsUtil.copyFilteredFilesPromise(srcFolderPath, modifiedHours);
                }else{
                    return;
                }
            }).then(feed => {
                /* let thePath;
                if(feed){
                    thePath = tmpFolderPath = feed;
                }else{
                    thePath = srcFolderPath;
                } */
                tmpFolderPath = feed;
                if(fs.existsSync(zipPath) && preparedZipPath){ // 不重复制作压缩包
                    return;
                }
                // return this.zipFolderHandler(thePath, { zipPath });
                console.log('archive #305 path:', tmpFolderPath, srcFolderPath+'.zip');
                return this.archiveFolderPromise(tmpFolderPath, srcFolderPath+'.zip');
            }).then(() => {
                if(!privateKeyPath || !fs.existsSync(privateKeyPath)){
                    if(password){
                        return null;
                    }else{
                        return Q.reject({code: 110, msg: 'no password'});
                    }
                }
                return Q.promise((rsv, rej) => {
                    fs.readFile(privateKeyPath, 'utf8', (err, rst) => {
                        if (err) {
                            return rej(err);
                        }
                        rsv(rst);
                    })
                })
            }).then(( feed ) => {
                // sshClient = new NodeSSH();
                sshClient = new Ssh2SftpClient();
                const sshOptions = {
                    host,
                    port,
                    username
                }
                if(feed){
                    sshOptions.privateKey = feed;
                }else{
                    sshOptions.password = password;
                }
                // const sshOptionsCopy = { ...sshOptions };
                // delete sshOptionsCopy.privateKey;
                // toPrint = {host, port, username, sshOptionsCopy}
                return sshClient.connect(sshOptions);
            }).then(() => {
                const deferred = Q.defer();
                setTimeout(function () {
                    deferred.resolve()
                }, 1000);
                return deferred.promise;
            }).then(() => {
                return sshClient.put(zipPath, destFilePath);
                /* return Q.promise((rsv, rej) => {
                    sshClient.putFile(zipPath, destFilePath, undefined, {
                        step: (total_transferred, chunk, total) => {
                            console.log('Uploaded', total_transferred, 'of', total);
                        }
                    }).then(function () {
                        rsv({ destFilePath, msg: 'OK', zipPath });
                    }, function (error) {
                        rej(error);
                    })
                }) */
            /* }).then(function () {
                return Q.promise((rsv, rej) => {
                    _this.ssh.exec('ls', ['-l', zipFileName], {
                        cwd: parentDestFolderPath,
                        onStdout (chunk) {
                            const str = chunk.toString('utf8');
                            console.log('#108 stdoutChunk:', str)
                            rsv(str)
                        },
                        onStderr (chunk) {
                            const str = chunk.toString('utf8');
                            console.log('#113 stderrChunk:', str)
                            rej(str);
                        }
                    })
                }) */
            }).then(() => {
                return this.getInitScriptPromise({leafFolderName, destFolderPath});
            }).then(feed => {
                return Q.promise((rsv, rej) => {
                    fs.writeFile(localBashFilePath, feed, { encoding: 'utf8', mode: 0o644, flag: 'w' }, (err, rst) => {
                        if(err){
                            rej(err);
                        }else{
                            rsv(rst);
                        }
                    });
                })
            }).then(() => {
                const remoteBashFilePath = `${parentDestFolderPath}${destPathSep}backupServer.sh`; // Path.resolve(parentDestFolderPath, 'backupServer.sh');
                return Q.promise((rsv, rej) => {
                    /* sshClient.putFile(localBashFilePath, remoteBashFilePath).then(function () {
                        rsv({ destFilePath, msg: 'OK', zipPath });
                    }, function (error) {
                        rej(error);
                    }) */
                    sshClient.put(localBashFilePath, remoteBashFilePath).then(function () {
                        rsv({ destFilePath, msg: 'OK', zipPath });
                    }, function (error) {
                        rej(error);
                    })
                })
            })/* .then(() => { // WangFan TODO 2020-10-31 08:46:32
                return sshClient.execCommand('chmod +x backupServer.sh', { cwd: parentDestFolderPath })
            }).then(() => {
                return sshClient.execCommand('./backupServer.sh', { cwd: parentDestFolderPath });
            }) *//* .then(() => {
                const qAll = [];
                qAll.push( this.removeFilePromise(zipPath) );
                qAll.push( this.removeFilePromise(localBashFilePath) );
                return Q.all(qAll);
            }) *//* .then(() => {
                const deferred = Q.defer();
                setTimeout(function(){deferred.resolve()}, 10000);
                return deferred.promise;
            }) *//* .then(() => {
                if(!tmpFolderPath){
                    return;
                }
                return Q.promise((rsv, rej) => {
                    // delete directory recursively
                    fs.rmdir(tmpFolderPath, { recursive: true }, (err) => {
                        if (err) {
                            rej(err);
                        }else{
                            console.log(`#268 ${tmpFolderPath} is deleted!`);
                            rsv(null);
                        }
                    });
                })
            }) */.then(() => {
                // sshClient.dispose();
                sshClient.end();
                rsvRoot({code: 111, msg: 'OK', tmpFolderPath, localBashFilePath, zipPath});
            }).done(null, err => {
                if (!err) {
                    return;
                }
                console.error('#75', err);
                rsvRoot({code: 110, msg: 'ERROR'});
            })
        })
    }

}
module.exports = Deploy;