# Third-party notices and provenance

Pida consumes the official Pi packages as dependencies, without vendoring or forking their source. The SDK/resource-loader integration follows the official release v1.2.0 full-control example. Pi retains the following notice. npm dependency packages retain their own license files; include their notices when redistributing bundled dependencies. This file is not a complete legal review of the transitive dependency graph.

Source: https://github.com/earendil-works/pi/blob/v1.2.0/LICENSE
Inspected: 2026-10-14. Package provenance/integrities are recorded in npm-shrinkwrap.json.

## Pi

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Other dependencies

- TypeBox: JSON Schema/type construction; see node_modules/typebox/license.
- TypeScript and @types/node: development-only compiler/type dependencies; retain their supplied license notices if redistributing those packages.
- All remaining transitive dependencies: see the original license files included in each installed package. Pida does not relicense them.

Pida's own package is marked UNLICENSED pending an explicit project-owner licensing decision; this does not alter any third-party license.
