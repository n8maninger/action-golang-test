# golang-test

This action runs `go test` and provides annotations from the output

## Inputs

All inputs are optional

| Input | Type | Description | Default 
--|--|--|--
package | string | the package to run tests for | ./...
args | string | semicolon delimited `go test` command line arguments |
show-long-running-tests | number | outputs a yellow warning for tests that take longer than the given number of seconds to complete, -1 to disable | 30
show-package-output | bool | includes additional package output in the log | false
show-passed-tests | bool | hides output from passed tests in the log | true
show-stdout | bool | shows the unparsed stdout from `go test` instead of the parsed output | false
skip-go-install | bool | skips installing and setting up Go, necessary if you are already running `actions/setup-go` as part of the job. | false

## Usage

Basic:
```yml
name: Test
on:
  pull_request:
    branches: [ master ]
  push:
    branches: [ master ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: n8maninger/action-golang-test@v1
```

Pass command line arguments:
```yml
name: Test
on:
  pull_request:
    branches: [ master ]
  push:
    branches: [ master ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: n8maninger/action-golang-test@v1
        with:
          args: "-race;-failfast;-tags=testing debug netgo"
```
