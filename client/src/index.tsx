#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./App.js";

render(<App serverUrl={process.env.SERVER_URL ?? "ws://localhost:2567"} />);
