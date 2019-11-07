import crypto from 'crypto';

export default class PairioTaskRegulator {
    constructor(config) {
        this._channels = {};

        if (!config.channels) {
            throw new Error(`Missing field in config: channels`);
        }
        if (config.channels.length === 0) {
            console.warn('No channels provided in config file');
        }
        for (let ch of config.channels) {
            this._channels[ch.name] = new Channel(ch);
        }
    }
    approveTask(taskName, channelName, collection, key, value, signature, req) {
        if (!this._channels[channelName]) {
            return { approved: false, reason: `Channel not found in config: ${channelName}` };
        }
        let channel = this._channels[channelName];
        if (!verifySignature(taskName, collection, key, value, channel.password(), signature)) {
            return { approve: false, reason: 'incorrect or missing signature', delay: 1000 };
        }
        if (taskName === 'get') {
            return channel.approveGetTask(req, collection, key);
        }
        else if (taskName === 'set') {
            return channel.approveSetTask(req, collection, key, value);
        }
        else {
            throw new Error(`Unexpected taskName in approveTask: ${taskName}`);
        }
    }
    finalizeTask(taskName, channelName, approvalObject) {
        if (!this._channels[channelName]) {
            return { approved: false, reason: `Channel not found in config: ${channelName}` };
        }
        let channel = this._channels[channelName];
        if (taskName === 'get') {
            return channel.finalizeGetTask(approvalObject);
        }
        else if (taskName === 'set') {
            return channel.finalizeSetTask(approvalObject);
        }
        else {
            throw new Error(`Unexpected taskName in finalizeTask: ${taskName}`);
        }
    }
}

class Channel {
    constructor(config) {
        this._password = config.password;
        this._channels = [];
        this._collections = [];

        for (let cc of config.collections) {
            this._collections.push(new Collection(cc));
        }
    }
    password() {
        return this._password;
    }
    approveGetTask(req, collection, key) {
        let cc = this._findCollection(collection);
        if (!cc) {
            return { approve: false, reason: `Collection not found for this channel: ${collection}` };
        }
        return cc.approveGetTask(key, req);
    }
    approveSetTask(req, collection, key, value) {
        let cc = this._findCollection(collection);
        if (!cc) {
            return { approve: false, reason: `Collection not found for this channel: ${collection}` };
        }
        return cc.approveSetTask(key, value, req);
    }
    finalizeGetTask(approvalObject) {
        approvalObject.collection.finalizeGetTask(approvalObject);
    }
    finalizeSetTask(approvalObject) {
        approvalObject.collection.finalizeSetTask(approvalObject);
    }
    _findCollection(collection) {
        for (let cc of this._collections) {
            if (cc.name() == collection) {
                return cc;
            }
        }
        return null;
    }
}

// Download or Upload quota
class Collection {
    constructor(config) {
        this._name = config.name;
        this._maxNumGetsPerMinute = config.maxNumGetsPerMinute;
        this._maxNumSetsPerMinute = config.maxNumSetsPerMinute;
        this._maxSimultaneous = 3;

        this._numActiveGets = 0;
        this._numActiveSets = 0;
        this._newMinute();

        this._deferredApprovals = [];
    }
    name() {
        return this._name;
    }
    _newMinute() {
        this._currentMinute = new Date();
        this._totalNumGetsThisMinute = 0;
        this._totalNumSetsThisMinute = 0;
        this._pendingNumGetsThisMinute = 0;
        this._pendingNumSetsThisMinute = 0;
    }
    approveGetTask(key, req) {
        let timestamp = new Date();
        if (!sameMinute(this._currentMinute, timestamp)) {
            this._newMinute();
        }
        let effectiveNumGets = 1;
        if (req.method === 'HEAD') {
            // we don't count it as a download if it is a HEAD request
            effectiveNumGets = 0;
        }
        if (this._totalNumGetsThisMinute + this._pendingNumGetsThisMinute + 1 > this._maxNumGetsPerMinute) {
            return { approve: false, reason: 'Exceeded number of gets per minute per day for this channel/collection.' };
        }
        let approval = {
            approve: true,
            collection: this,
            effectiveNumGets: effectiveNumGets,
            timestamp: timestamp,
            delay: null
        };
        approval.start = () => {
            this._numActiveGets += 1;
            this._pendingNumGetsThisMinute += effectiveNumGets;
        };
        approval.checkReady = () => {
            return (this._numActiveGets + 1 <= this._maxSimultaneous);
        }
        if (approval.checkReady()) {
            approval.start();
        }
        else {
            this._deferredApprovals.push(approval);
            approval.defer = true;
        }
        return approval;
    }
    approveSetTask(key, value, req) {
        let timestamp = new Date();
        if (!sameMinute(this._currentMinute, timestamp)) {
            this._newMinute();
        }
        let effectiveNumSets = 1;
        if (req.method === 'HEAD') {
            // we don't count it as a download if it is a HEAD request
            effectiveNumSets = 0;
        }
        if (this._totalNumSetsThisMinute + this._pendingNumSetsThisMinute + 1 > this._maxNumSetsPerMinute) {
            return { approve: false, reason: 'Exceeded number of sets per minute per day for this channel/collection.' };
        }
        let approval = {
            approve: true,
            collection: this,
            effectiveNumSets: effectiveNumSets,
            timestamp: timestamp,
            delay: null
        };
        approval.start = () => {
            this._numActiveSets += 1;
            this._pendingNumSetsThisMinute += effectiveNumSets;
        };
        approval.checkReady = () => {
            return (this._numActiveSets + 1 <= this._maxSimultaneous);
        }
        if (approval.checkReady()) {
            approval.start();
        }
        else {
            this._deferredApprovals.push(approval);
            approval.defer = true;
        }
        return approval;
    }
    finalizeGetTask(approvalObject) {
        this._numActiveGets -= 1;
        if (sameMinute(approvalObject.timestamp, this._currentMinute)) {
            this._pendingNumGetsThisMinute -= approvalObject.effectiveNumGets;
            this._totalNumGetsThisMinute += approvalObject.effectiveNumGets;
        }
        let somethingChanged = false;
        for (let i = 0; i < this._deferredApprovals.length; i++) {
            if (this._deferredApprovals[i].checkReady()) {
                this._deferredApprovals[i].start();
                this._deferredApprovals[i].defer = false;
                somethingChanged = true;
            }
        }
        if (somethingChanged) {
            let newDeferredApprovals = [];
            for (let da of this._deferredApprovals) {
                if (da.defer) {
                    newDeferredApprovals.push(da);
                }
            }
            this._deferredApprovals = newDeferredApprovals;
        }
        // console.info({
        //     pendingNumGetsThisMinute: this._pendingNumGetsThisMinute,
        //     totalNumGetsThisMinute: this._totalNumGetsThisMinute
        // });
    }
}

function sha1OfObject(obj) {
    let shasum = crypto.createHash('sha1');
    shasum.update(JSON.stringify(obj));
    return shasum.digest('hex');
}

function verifySignature(name, collection, key, value, password, signature) {
    if (process.env.PAIRIO_TEST_SIGNATURE) {
        if ((signature === process.env.PAIRIO_TEST_SIGNATURE)) {
            console.warn('WARNING: verified using test signature from PAIRIO_TEST_SIGNATURE environment variable');
            return true;
        }
    }
    let obj = {
        // keys in alphabetical order
        collection: collection,
        key: key,
        name: name,
        password: password
    };
    if ((value !== null) && (value !== undefined)) {
        obj.value = value;
    }
    let expectedSignature = sha1OfObject(obj);
    return ((signature === expectedSignature));
}

function sameMinute(d1, d2) {
    return (
        (d1.getFullYear() === d2.getFullYear()) &&
        (d1.getMonth() === d2.getMonth()) &&
        (d1.getDate() === d2.getDate()) &&
        (d1.getHours() === d2.getHours()) &&
        (d1.getMinutes() === d2.getMinutes())
    );
}

