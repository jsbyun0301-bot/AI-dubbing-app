const fs = require('fs');
const cp = require('child_process');
const files = fs.readdirSync('temp').filter(f => f.endsWith('.mp4') && f.startsWith('output'));

if (files.length === 0) {
    console.log("No temp output mp4 found to inspect.");
    process.exit(1);
}

const lastFile = 'temp\\' + files[files.length - 1];
console.log("Analyzing:", lastFile);
try {
    const probe = cp.execSync(`ffprobe -v error -show_format -show_streams -of json "${lastFile}"`);
    console.log(probe.toString());
} catch(e) {
    console.error("FFPROBE ERROR:", e.message);
}
