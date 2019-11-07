import MongoClient from 'mongodb';

export default class PairioDatabase {
    constructor() {
    }
    async connect(mongodbURL) {
        this._client = await MongoClient.connect(mongodbURL, {
            useNewUrlParser: true
        });
        this._db = this._client.db('pairio');
    }
    async get(collection, key) {
        let record = {
            collection: collection,
            key: key
        };
        let collec = this._db.collection("pairs");
        let cursor = collec.find(record);
        let docs = await cursor.toArray();
        if (docs.length === 0 ) {
            return {success: false, error: 'Not found'};
        }
        if (docs.length > 1) {
            return {success: false, error: 'Unexpected: more than one document found for key.'};
        }
        return {
            success: true,
            value: docs[0].value
        };
    }
    async set(collection, key, value) {
        let record = {
            collection: collection,
            key: key
        };
        let collec = this._db.collection("pairs");

        try {
            await collec.updateOne(record, {
                $set: {
                    value: value
                }
            }, {
                upsert: true
            });
        }
        catch(err) {
            return {
                success: false,
                error: err.message
            };
        }

        return {
            success: true,
        };
    }
}

function sendFile(res, path, root) {
    return new Promise((resolve, reject) => {
        res.sendFile(path, {
            root: root
        }, function(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        })
    });
}
