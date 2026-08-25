"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflow = void 0;
var langgraph_1 = require("@langchain/langgraph");
var state_1 = require("./state");
// Removed callMemoryAgent since it no longer exists
var nodes_1 = require("./nodes");
var builder = new langgraph_1.StateGraph(state_1.GraphState)
    // Now we only have one main node that acts as the router and has access to all tools
    .addNode("main_agent", nodes_1.callMainAgent)
    // The new Sequence Flow:
    .addEdge(langgraph_1.START, "main_agent") // Send user input directly to the Main Agent
    .addEdge("main_agent", langgraph_1.END); // After the Main Agent replies (and uses tools if needed), finish the graph
exports.workflow = builder;
