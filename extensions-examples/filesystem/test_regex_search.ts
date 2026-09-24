import { search } from "./regex_search.ts";

const folder = "E:/news";
const patterns = ["stock"];
const extensions = [".txt", ".md", ".json", ".html"];

const results = search(folder, patterns, extensions);
console.log(JSON.stringify(results, null, 2));
