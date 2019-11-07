# pairio

Pairio is a system for associating hashes of inputs (keys) with hashes of
outputs (values) so that results of processing pipelines may be cached locally
and/or on the cloud. Essentially it is a key/value store where the keys and
values are meant to be 40-character SHA-1 hashes of objects or files.

## Installation

```
pip install --upgrade pairio
```

Or a development installation (after cloning this repo and stepping into the directory):

```
pip install -e .
```

See the documentation below for hosting your own pairio server.

## Basic usage on local machine

To use pairio on the local computer, simply run

```
import pairio as pa
key='some-string-80-or-fewer-characters'
val='another-string-80-or-fewer-characters'
pa.set(key, val)
```

Then later retrieve the value

```
val = pa.get(key)
print(val)
```

Often the key will not be a string, but will instead be a Python dict. For example

```
pa.set(dict(operation='add', arg1=12, arg2=30), '42')
```

In this case pairio will use the hash of the JSON string of the key as the
40-character string key to associate with the value. Thus the result of this
operation could be retrieved later by passing in the same dict key:

```
result = pa.get(dict(operation='add', arg1=12, arg2=30))
print(result)
```

But most of the time the output of a process is more than just a small string.
So the primary use case is when the value is the SHA-1 hash of a file. For example

```
pa.set(dict(operation='bash-stdout', script='echo "Hello, pairio."'}, 'a09fd13fd92800aeafe475e9113efe216788d934')
```

Here, the value is the SHA-1 hash of the file whose contents is "Hello, pairio."

To be useful in this way, pairio is meant to be used in conjunction with a content-addressable storage database
such as [kachery](https://github.com/flatironinstitute/kachery)

## Storing pairs in the cloud

Key/value pairs can also be stored in the cloud by pointing to a pairio server. More info to come.

## Hosting a pairio server

To host a pairio server you will need to create a directory with a pairio.json
configuration file inside. For an example configuration file, see
[server/example_pairio.json](server/example_pairio.json). It is possible to
configure multiple password-protected channels in order to limit access to groups of users.
For example, you may want some subset of users to have read but not write access to some collections.

You can either use docker or NodeJS 12.x.x to run the server.
The easiest is to use docker.

For docker instructions, see [server/docker_instructions.txt](server/docker_instructions.txt).

## License

Apache 2.0 - see the LICENSE file

Please acknowledge the authors if you fork this repository or make a derivative
work. I'd prefer if you could collaborate and contribute your improvements back to
this repo.

## Authors

Jeremy Magland, Center for Computational Mathematics, Flatiron Institute

## Help wanted

Seeking co-developers and testers.