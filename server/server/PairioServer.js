import express from 'express';
import https from 'https';
import http from 'http';
import PairioTaskRegulator from './PairioTaskRegulator.js';
import PairioDatabase from './PairioDatabase.js';
import fs from 'fs';

export default class PairioServer {
    constructor(pairioDir, mongodbURL) {
        this._mongodbURL = mongodbURL;
        const config = readJsonFile(pairioDir + '/pairio.json');
        this._pairioDir = pairioDir;
        this._regulator = new PairioTaskRegulator(config);;
        this._database = new PairioDatabase();

        this._app = express(); // the express app

        this._app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this._app.use(cors()); // in the future, if we want to do this
        this._app.use(express.json());

        this._app.get('/probe', async (req, res) => {
            await waitMsec(1000);
            try {
                await this._apiProbe(req, res) 
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.get('/get/:collection/:key', async (req, res) => {
            let approvalObject = await this._approveTask('get', req.query.channel, req.params.collection, req.params.key, null, req.query.signature, req);
            if (!approvalObject.approve) {
                await this._errorResponse(req, res, 500, approvalObject.reason);
                return;
            }
            try {
                await this._apiGet(req, res);
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
            finally {
                this._finalizeTask('get', req.query.channel, approvalObject);
            }
        });
        this._app.get('/set/:collection/:key/:value', async (req, res) => {
            let approvalObject = await this._approveTask('set', req.query.channel, req.params.collection, req.params.key, req.params.value, req.query.signature, req);
            if (!approvalObject.approve) {
                await this._errorResponse(req, res, 500, approvalObject.reason);
                return;
            }
            try {
                await this._apiSet(req, res);
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
            finally {
                this._finalizeTask('get', req.query.channel, approvalObject);
            }
        });
    }
    async _apiProbe(req, res) {
        res.json({ success: true });
    }
    async _apiGet(req, res) {
        let params = req.params;
        let query = req.query;
        let result = await this._database.get(params.collection, params.key);
        if ((!result.success)) {
            await this._errorResponse(req, res, 500, result.error);
            return;
        }
        res.json(result);
    }
    async _apiSet(req, res) {
        let params = req.params;
        let query = req.query;
        let result = await this._database.set(params.collection, params.key, params.value);
        if ((!result.success)) {
            await this._errorResponse(req, res, 500, result.error);
            return;
        }
        res.json(result);
    }
    async _errorResponse(req, res, code, errstr) {
        console.info(`Responding with error: ${code} ${errstr}`);
        try {
            res.status(code).send(errstr);
        }
        catch(err) {
            console.warn(`Problem sending error: ${err.message}`);
        }
        await waitMsec(100);
        try {
            req.connection.destroy();
        }
        catch(err) {
            console.warn(`Problem destroying connection: ${err.message}`);
        }
    }
    async _approveTask(taskName, channel, collection, key, value, signature, req) {
        let approval = this._regulator.approveTask(taskName, channel, collection, key, value, signature, req);
        if (approval.defer) {
            console.info(`Deferring ${taskName} task`);
            while (approval.defer) {
                await waitMsec(500);
            }
            console.info(`Starting deferred ${taskName}`);
        }
        if (approval.delay) {
            await waitMsec(approval.delay);
        }
        return approval;
    }
    _finalizeTask(taskName, channel, approvalObject) {
        return this._regulator.finalizeTask(taskName, channel, approvalObject);
    }
    async listen(port) {
        await this._database.connect(this._mongodbURL);
        await start_http_server(this._app, port);
    }
}

function waitMsec(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function start_http_server(app, listen_port) {
    app.port = listen_port;
    if (process.env.SSL != null ? process.env.SSL : listen_port % 1000 == 443) {
        // The port number ends with 443, so we are using https
        app.USING_HTTPS = true;
        app.protocol = 'https';
        // Look for the credentials inside the encryption directory
        // You can generate these for free using the tools of letsencrypt.org
        const options = {
            key: fs.readFileSync(__dirname + '/encryption/privkey.pem'),
            cert: fs.readFileSync(__dirname + '/encryption/fullchain.pem'),
            ca: fs.readFileSync(__dirname + '/encryption/chain.pem')
        };

        // Create the https server
        app.server = https.createServer(options, app);
    } else {
        app.protocol = 'http';
        // Create the http server and start listening
        app.server = http.createServer(app);
    }
    await app.server.listen(listen_port);
    console.info(`Server is running ${app.protocol} on port ${app.port}`);
}

function readJsonFile(filePath) {
    const txt = fs.readFileSync(filePath);
    try {
        return JSON.parse(txt);
    }
    catch (err) {
        throw new Error(`Unable to parse JSON of file: ${filePath}`);
    }
}
