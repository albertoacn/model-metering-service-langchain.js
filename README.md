# Model Metering Service for LangChain.js

## Overview

Welcome! This is a take-home assignment designed to assess your ability to design and implement a potential solution to a problem relevant to building AI applications. You'll be working with a proxy service that adds metering and budget controls to AI model interactions, demonstrating your skills in API design, middleware patterns, and resource management.

## Background

At LangChain, we're working on a number of open source products/ commercial offerings to help developers build AI applications with confidence. We're looking for candidates who are interested in working on the problems that developers are facing today, and who are willing to go the extra mile to solve them. Some of the products we're working on are:

- LangChain: A framework for building applications using generative AI.
- LangGraph: A framework for long running and stateful agents.
- LangGraph Platform: A PaaS offering to help run and manage LangGraph at scale.
- LangSmith: A platform for building, testing, and monitoring AI applications.

## Project Overview

In this project, we've created a minimal proxy service that mimics Anthropic's Messages API which is usable with LangChain.js. You'll work to iterate on this service to add metering and budget controls for clients calling the service.

```tree
.
├── packages
│   └── service                   # Proxy service
│       ├── package.json
│       ├── src
│       │   ├── messages
│       │   │   ├── ...
│       │   │   └── generate.ts   # Generates a response from a prompt and a number of tokens
│       │   ├── const.ts          # Project constants
│       │   ├── data.ts           # Example in-memory storage for usage data
│       │   └── server.ts         # Server implementation that mocks the Anthropic API
│       ├── tests
│       │   └── client.test.ts    # Tests for the service
│       └── tsconfig.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── README.md
```

## Task Overview

You'll be working to iterate on the service to add the following features:

- Streaming support on `POST /v1/messages` when `json.stream === true`, emitting events compatible with the Anthropic streaming protocol (see the [Anthropic streaming docs](https://docs.anthropic.com/en/docs/build-with-claude/streaming)).
- Validate `x-api-key` and reject unknown keys with an appropriate 401/403 error.
- Token counting for each request: track `input_tokens` and `output_tokens` in the response `usage` object, and attribute usage to the API key.
- Ability to set token limits for API key, which will reject requests that exceed the limit.

You can find the tests that are expected to pass in [`packages/service/tests/client.test.ts`](packages/service/tests/client.test.ts), or optionally run the tests with `pnpm test` in either the root or `packages/service` directory. Note that you will be required to implement the tests that are already stubbed out, and write new tests for any features you add.

### Nice to Have

Time permitting, we also award style points to those who get creative and add features not described in this document. To get some ideas going, here are some examples:

- Add support for different providers (e.g. OpenAI, Gemini, etc.)
- Pluggable tokenization strategy (fallback to a simple chars→tokens approximation if you don’t want extra deps)
- Cost tracking and reporting depending on model selection using `TOKEN_COSTS` in `packages/service/src/const.ts`
- Support "reseting" the token limit for an API key based on a schedule (e.g. daily, weekly, monthly, or none)
- Rate limiting and/or concurrency controls per API key
- Persistent storage option beyond in-memory (e.g., file- or disk-backed SQLite)
- Ability to track and report usage by API key over time
- A web interface for managing API keys and their limits

Note that these are not required, and you should first prioritize the requirements listed above.

## What we're looking for

It's totally fine if your solution is a work in progress, provided that it demonstrates an understanding of what's required to solve this, and that you're on the road to a complete solution.

- How you approach the problem
- How you handle an existing codebase and tests
- How you document your work
- How you test your work
- How you scope potential features

## Submission

The code archive associated with this assignment is a zip file initialized with a git repo that only has one commit.

- Create a separate branch off of `main` with your implementation, ideally keeping your commit history as clean as possible.
- Keep a running log of your thoughts and decisions in a separate markdown file.
- When you're done, you can either (1) zip up the repo and send it to us, or (2) push it to a public github repo and send us the link.

## More Info

### Environment Setup

- Node.js 18+
- your favorite package manager

```bash
# Install dependencies
pnpm install

# Run tests
cd packages/services
pnpm test
```

### Time Expectation

Plan for 2 hours. A well-thought-out partial solution is perfectly acceptable. Focus on correctness, clarity, and where you spend your time. We want to respect your time, so please don't spend more than 2 hours on this.

### Questions?

This assignment is intentionally open-ended to see how you approach ambiguous problems. If you have clarifying questions that would significantly impact your approach, feel free to ask.

---

We're excited to see what you come up with. Good luck!
