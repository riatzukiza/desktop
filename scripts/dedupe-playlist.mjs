#!/usr/bin/env node
import {open, readFile} from  "node:fs/promises";
import { parseArgs } from "node:util";

const {positionals, values} = parseArgs({args:process.argv.slice(2), options:{
    input:{
        type:"string"
    },
    output:{
        type:"string"
    }
}});
async function getUniqueLinesFromFile (path) {
    const text = await readFile(path,"utf8");
    const lines = text.split("\n");
    const observed = new Set();
    for (const line of lines) {
        if(observed.has(line)) continue;
        observed.add(line);
    }
    return [...observed];
}

const uniqueEntries = await getUniqueLinesFromFile(values.input);


console.log(uniqueEntries)
console.log(values)
const outfile = await open(values.output,"w");
for (let line of uniqueEntries) {
    await outfile.write(Buffer.from(line+"\n"));
}
