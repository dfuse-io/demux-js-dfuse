<!-- <p align="center">
  <a href="" rel="noopener">
 <img width=200px height=200px src="https://i.imgur.com/6wj0hh6.jpg" alt="Project logo"></a>
</p> -->

<h3 align="center">demux-js-dfuse</h3>

<div align="center">

[![Status](https://img.shields.io/badge/status-alpha-blue.svg)]()
[![GitHub Issues](https://img.shields.io/github/issues/dfuse-io/demux-js-dfuse.svg)](https://github.com/dfuse-io/demux-js-dfuse/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/dfuse-io/demux-js-dfuse.svg)](https://github.com/dfuse-io/demux-js-dfuse/pulls)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)

</div>

---

<p align="center">A demux-js Action Reader Implementation  for dfuse.io
    <br> 
</p>

## 📝 Table of Contents

- [About](#about)
- [Getting Started](#getting_started)
- [Usage](#usage)
- [Acknowledgments](#acknowledgement)

## 🧐 About <a name = "about"></a>

`demux-js-dfuse` implements an ActionReader for [demux-js](https://github.com/EOSIO/demux-js) to allow for sourcing blockchain events to deterministically update queryable datastores and trigger side effects.

## 🏁 Getting Started <a name = "getting_started"></a>

To run a basic example, run the following command:

`yarn run:example`

The code for the example can be found in the `/example` directory at the root of the project.

## 🛫 Usage <a name="usage"></a>

To use dfuse as your data source, simply pass a DfuseActionReader instance to a Demux ActionWatcher.

You will need to create your own ActionHandler. For more information on this, [visit the demux-js repository](https://github.com/EOSIO/demux-js).

To generate a dfuse API key, visit [the dfuse website](https://www.dfuse.io).

The DfuseActionReader class supports the following parameters:

- `dfuseApiKey: string`. Required. An API key that can be obtained from the [dfuse.io website](dfuse.io).
- `startAtBlock: number`. Optional. Defaults to `1`. For positive values, this sets the first block that this will start at. For negative values, this will start at (most recent block + startAtBlock), effectively tailing the chain. Be careful when using this feature, as this will make your starting block dynamic.
- `onlyIrreversible: boolean`. Optional. Defaults to `false`. If set to `true`, only irreversible blocks will be fetched
- `query: string`. Optional. Defaults to `status:executed`. A dfuse SQE query. For more informations, [see the docs](https://docs.dfuse.io/#dfuse-query-language).

```js
import { BaseActionWatcher } from "demux"
import { ObjectActionHandler } from "./ObjectActionHandler"
import { handlerVersion } from "./handlerVersions/v1"
import { DfuseActionReader } from "demux-js-dfuse"

const actionHandler = new ObjectActionHandler([handlerVersion], { validateBlockHashes: false })

const dfuseActionReader = new DfuseActionReader({
  dfuseApiKey: "YOUR DFUSE API KEY",
  startAtBlock: 1,
  onlyIrreversible: false
})

const actionWatcher = new BaseActionWatcher(dfuseActionReader, actionHandler, 100)
actionWatcher.watch()
```

## 🔧 Running the tests <a name = "tests"></a>

All tests are run using Jest. Use `yarn test` to run them.

## 🎉 Acknowledgements <a name = "acknowledgement"></a>

- Thanks to [@flux627](https://github.com/flux627) for the great work on demux-js!
