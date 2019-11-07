import os
from typing import Union, Tuple, Optional, List
import simplejson
import json
import hashlib
import tempfile
import time
import requests
import urllib.request as request
import shutil
import io
import sys
import pathlib
from .filelock import FileLock

_global_config=dict(
    url=os.getenv('PAIRIO_URL', None),
    channel=os.getenv('PAIRIO_CHANNEL', None),
    password=os.getenv('PAIRIO_PASSWORD', None),
    collection=os.getenv('PAIRIO_COLLECTION', 'default'),
    database_path=os.getenv('PAIRIO_DB_PATH', str(pathlib.Path.home()) + '/.pairio'),
    get_from='local',  # 'local', 'remote', 'local_then_remote', 'remote_then_local'
    set_to='local',  # 'local', 'remote', 'local_and_remote'
    verbose=False
)

def set_config(*,
        url: Union[str, None]=None,
        channel: Union[str, None]=None,
        password: Union[str, None]=None,
        collection: Union[str, None]=None,
        get_from: Union[str, None]=None,
        set_to: Union[str, None]=None,
        verbose: Union[str, None]=None
) -> None:
    if url is not None:
        _global_config['url'] = url
    if channel is not None:
        _global_config['channel'] = channel
    if password is not None:
        _global_config['password'] = password
    if collection is not None:
        _global_config['collection'] = collection
    if get_from is not None:
        assert get_from in ['local', 'remote', 'local_then_remote', 'remote_then_local']
        _global_config['get_from'] = get_from
    if set_to is not None:
        assert set_to in ['local', 'remote', 'local_and_remote']
        _global_config['set_to'] = get_from
    if verbose is not None:
        _global_config['verbose'] = verbose

def get_config() -> dict:
    return _load_config()

def _load_config(**kwargs) -> dict:
    if 'config' in kwargs:
        ret = kwargs['config']
    else:
        ret = dict()
        for key, val in _global_config.items():
            ret[key] = val
    for key, val in kwargs.items():
        ret[key] = val
    get_from = ret['get_from']
    if get_from is not None:
        assert get_from in ['local', 'remote', 'local_then_remote', 'remote_then_local']
    set_to = ret['set_to']
    if set_to is not None:
        assert set_to in ['local', 'remote', 'local_and_remote']
    return ret

def set(key: Union[str, dict], value: str, **kwargs) -> None:
    config = _load_config(**kwargs)
    collection: str = config['collection']
    if len(value) > 80:
        raise Exception('Value cannot have length > 80')
    key2: str = ''
    if type(key) == dict:
        key2 = _sha1_of_object(key)
    elif type(key) == str:
        key2 = str(key)
    else:
        raise Exception('Unexpected type for key')
    if len(key2) > 80:
        raise Exception('Key cannot have length > 80')
    set_to = config['set_to']
    if set_to == 'local':
        _set_local(collection, key2, value, config=config)
    elif set_to == 'remote':
        _set_remote(collection, key2, value, config=config)
    elif set_to == 'local_and_remote':
        _set_local(collection, key2, value, config=config)
        _set_remote(collection, key2, value, config=config)
    else:
        raise Exception('Unexpected set_to')

def get(key: Union[str, dict], **kwargs) -> Union[str, None]:
    config = _load_config(**kwargs)
    collection: str = config['collection']
    key2: str = ''
    if type(key) == dict:
        key2 = _sha1_of_object(key)
    elif type(key) == str:
        key2 = str(key)
    else:
        raise Exception('Unexpected type for key.')
    if len(key2) > 80:
        raise Exception('Key cannot have length > 80')
    get_from = config['get_from']
    if get_from == 'local':
        return _get_local(collection, key2, config=config)
    elif get_from == 'remote':
        return _get_remote(collection, key2, config=config)
    elif get_from == 'local_then_remote':
        val = _get_local(collection, key2, config=config)
        if val is not None:
            return val
        return _get_remote(collection, key2, config=config)
    elif get_from == 'remote_then_local':
        val = _get_remote(collection, key2, config=config)
        if val is not None:
            return val
        return _get_local(collection, key2, config=config)
    else:
        raise Exception('Unexpected set_to')

def _get_file_path_for_hash(keyhash: str, *, config: dict, _create: bool) -> str:
    database_path = config['database_path']
    path = os.path.join(database_path, keyhash[0:2], keyhash[2:4])
    if _create:
        if not os.path.exists(path):
            try:
                os.makedirs(path)
            except:
                if not os.path.exists(path):
                    raise Exception(
                        'Unexpected problem. Unable to create directory: ' + path)
    return os.path.join(path, keyhash)

def _get_local(collection: str, key: Union[str, dict], *, config: dict) -> Union[str, None]:
    _disable_lock = False
    hash0 = _sha1_of_object(dict(
        collection=collection,
        key=key
    ))
    fname0 = _get_file_path_for_hash(hash0, config=config, _create=False)
    if not os.path.exists(fname0):
        return None
    with FileLock(fname0 + '.lock', _disable_lock=_disable_lock, exclusive=False):
        txt = _read_text_file(fname0)
        return txt

def _set_local(collection: str, key: Union[str, dict], value: Union[str, None], *, config: dict) -> bool:
    hash0 = _sha1_of_object(dict(
        collection=collection,
        key=key
    ))
    fname0 = _get_file_path_for_hash(hash0, config=config, _create=True)
    with FileLock(fname0 + '.lock', exclusive=True):
        if value is None:
            if os.path.exists(fname0):
                os.unlink(fname0)
        else:
            _write_text_file(fname0, value)
    return True

def _get_remote(collection: str, key: Union[str, dict], *, config: dict) -> Union[str, None]:
    keyhash = _hash_of_key(key)
    url_get: str = _form_get_url(collection=collection, key=keyhash, config=config)
    get_resp: dict = _http_get_json(url_get)
    if not get_resp['success']:
        return None
    return get_resp.get('value', None)

def _set_remote(collection: str, key: Union[str, dict], value: Union[str, None], *, config) -> bool:
    keyhash = _hash_of_key(key)
    url_set: str = _form_set_url(collection=collection, key=keyhash, value=value, config=config)
    set_resp: dict = _http_get_json(url_set)
    if not set_resp['success']:
        return False
    return True

def _form_get_url(collection: str, key: str, *, config: dict):
    url = _get_config_url(config)
    channel = _get_config_channel(config)
    signature = _sha1_of_object(dict(
        collection=collection,
        key=key,
        name='get',
        password=_get_config_password(config)
    ))
    return '{}/get/{}/{}?channel={}&signature={}'.format(url, collection, key, channel, signature)

def _form_set_url(collection: str, key: str, value: Union[str, None], *, config: dict) -> str:
    url = _get_config_url(config)
    channel = _get_config_channel(config)
    obj = dict(
        collection=collection,
        key=key,
        name='set',
        password=_get_config_password(config)
    )
    if value is not None:
        obj['value'] = value
    signature = _sha1_of_object(obj)
    if value is not None:
        return '{}/set/{}/{}/{}?channel={}&signature={}'.format(url, collection, key, value, channel, signature)
    else:
        return '{}/set/{}/{}?channel={}&signature={}'.format(url, collection, key, channel, signature)

def _hash_of_key(key: Union[str, dict]) -> str:
    if (type(key) == dict) or (type(key) == list):
        key2 = json.dumps(key, sort_keys=True, separators=(',', ':'))
        return _sha1_of_string(key2)
    else:
        return _sha1_of_string(str(key))

def _get_config_url(config):
    if config['url']:
        return config['url']
    else:
        if 'PAIRIO_URL' in os.environ:
            return os.environ['PAIRIO_URL']
        else:
            raise Exception('You need to configure the pairio url or set the PAIRIO_URL environment variable.')

def _get_config_channel(config):
    if config['channel']:
        return config['channel']
    else:
        if 'PAIRIO_CHANNEL' in os.environ:
            return os.environ['PAIRIO_CHANNEL']
        else:
            raise Exception('You need to configure the PAIRIO channel or set the PAIRIO_CHANNEL environment variable.')

def _get_config_password(config):
    if config['password']:
        return config['password']
    else:
        if 'PAIRIO_PASSWORD' in os.environ:
            return os.environ['PAIRIO_PASSWORD']
        else:
            raise Exception('You need to configure the pairio password or set the PAIRIO_PASSWORD environment variable.')

def _sha1_of_string(txt: str) -> str:
    hh = hashlib.sha1(txt.encode('utf-8'))
    ret = hh.hexdigest()
    return ret

def _sha1_of_object(obj: object) -> str:
    txt = json.dumps(obj, sort_keys=True, separators=(',', ':'))
    return _sha1_of_string(txt)

def _read_json_file(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def _read_text_file(path: str) -> str:
    with open(path) as f:
        return f.read()


def _write_json_file(obj: object, path: str) -> None:
    with open(path, 'w') as f:
        json.dump(obj, f)


def _write_text_file(fname: str, txt: str) -> None:
    with open(fname, 'w') as f:
        f.write(txt)

def _http_get_json(url: str, verbose: Optional[bool]=False, retry_delays: Optional[List[float]]=None) -> dict:
    timer = time.time()
    if retry_delays is None:
        retry_delays = [0.2, 0.5]
    if verbose is None:
        verbose = (os.environ.get('HTTP_VERBOSE', '') == 'TRUE')
    if verbose:
        print('_http_get_json::: ' + url)
    try:
        req = request.urlopen(url)
    except:
        if len(retry_delays) > 0:
            print('Retrying http request in {} sec: {}'.format(
                retry_delays[0], url))
            time.sleep(retry_delays[0])
            return _http_get_json(url, verbose=verbose, retry_delays=retry_delays[1:])
        else:
            return dict(success=False, error='Unable to open url: ' + url)
    try:
        ret = json.load(req)
    except:
        return dict(success=False, error='Unable to load json from url: ' + url)
    if verbose:
        print('Elapsed time for _http_get_json: {} {}'.format(time.time() - timer, url))
    return ret