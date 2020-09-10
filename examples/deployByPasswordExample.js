const Deploy = require('forever-ssh-deploy');

const author = 'your name';
const srcFolderPath = 'the path for the local project sub folder which is to replace the remote counterpart';
const modifiedHours = 24;
const deployConfigs = [
    {
        destFolderPath: 'remote project sub folder which is to be replaced by the local counterpart',
        host: 'xxx.xxx.xxx.xxx',
        username: 'developer',
        port: 22,
        password: 'your password'
    },
    {
        destFolderPath: 'remote project #2 sub folder which is to be replaced by the local counterpart',
        host: 'yyy.yyy.yyy.yyy',
        username: 'developer #2',
        port: 22,
        password: 'your password #2'
    }
]

const deployers = deployConfigs.filter(a => a).map(a => {
    const aCopy = { ...a };
    aCopy.author = author;
    aCopy.srcFolderPath = srcFolderPath;
    aCopy.modifiedHours = modifiedHours; // only upload files modified within limit hours
    return new Deploy(aCopy);
})
const recur = () => {
    if(deployers.length < 1){
        return;
    }
    const task = deployers.shift();
    task.exec().then(recur);
}
recur();