const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files (like index.html)
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    let javaProcess = null;

    socket.on('run-code', (data) => {
        // Support new object format { code, args } and legacy string format
        let code = "";
        let argsString = "";

        if (typeof data === 'string') {
            code = data;
        } else {
            code = data.code;
            argsString = data.args || "";
        }

        // SAFETY WARNING: This writes and executes arbitrary code on your machine.
        // DO NOT deploy this to a public server without sandboxing (e.g., Docker).
        
        const fileName = `Main_${socket.id}.java`;
        
        // Parse args string into array, respecting quotes
        // Regex matches non-whitespace sequences OR quoted sequences
        const argsArray = argsString.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        // Remove surrounding quotes from args
        const finalArgs = argsArray.map(arg => arg.replace(/^"|"$/g, ''));

        const runDir = path.join(__dirname, 'temp', socket.id);
        
        if (!fs.existsSync(runDir)){
            fs.mkdirSync(runDir, { recursive: true });
        }

        const filePath = path.join(runDir, 'Main.java');

        // Write the Java code to file
        fs.writeFile(filePath, code, (err) => {
            if (err) {
                socket.emit('output', `Error writing file: ${err.message}\n`);
                return;
            }

            socket.emit('output', "Compiling...\n");

            // Compile: javac Main.java
            const javac = spawn('javac', ['Main.java'], { cwd: runDir });

            javac.stderr.on('data', (data) => {
                socket.emit('output', `Compilation Error: ${data.toString()}`);
            });

            javac.on('close', (code) => {
                if (code !== 0) {
                    socket.emit('output', `\nCompilation failed with code ${code}.\n`);
                } else {
                    socket.emit('output', "Running...\n-------------------------\n");
                    
                    // Run: java Main [args]
                    javaProcess = spawn('java', ['Main', ...finalArgs], { cwd: runDir });

                    javaProcess.stdout.on('data', (data) => {
                        socket.emit('output', data.toString());
                    });

                    javaProcess.stderr.on('data', (data) => {
                        socket.emit('output', `Error: ${data.toString()}`);
                    });

                    javaProcess.on('close', (code) => {
                        socket.emit('output', `\n-------------------------\nProcess exited with code ${code}.`);
                        // Cleanup
                        cleanup(runDir);
                    });
                }
            });
        });
    });

    // Handle standard input from the frontend (for Scanner, etc.)
    socket.on('input', (inputData) => {
        if (javaProcess && javaProcess.stdin) {
            javaProcess.stdin.write(inputData + "\n");
        }
    });

    socket.on('disconnect', () => {
        if (javaProcess) {
            javaProcess.kill();
        }
        // Cleanup temp dir
        const runDir = path.join(__dirname, 'temp', socket.id);
        cleanup(runDir);
    });
});

function cleanup(dir) {
    if (fs.existsSync(dir)) {
        fs.rm(dir, { recursive: true, force: true }, (err) => {
            if (err) console.error("Cleanup error:", err);
        });
    }
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});