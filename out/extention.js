const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function activate(context) {
    const lspPath = vscode.workspace.getConfiguration('termslang').get('lspPath');

    if (!lspPath) {
        vscode.window.showErrorMessage('Termslang LSP path is not configured.');
        return;
    }

    const autoCompleteProvider = vscode.languages.registerCompletionItemProvider('termslang', {
        provideCompletionItems(document, position) {
            return new Promise((resolve, reject) => {
                const filePath = document.uri.fsPath;
                const currentLine = position.line;
                const currentCol = position.character;
                const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));

                fs.writeFile(tempFilePath, document.getText(), (err) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Error writing temp file: ${err}`);
                        reject(err);
                        return;
                    }

                    exec(`${lspPath} lsp "${tempFilePath}" ${currentLine} ${currentCol} false`, (error, stdout, stderr) => {
                        if (error) {
                            vscode.window.showErrorMessage(`Error running LSP: ${stderr}`);
                            reject(error);
                            return;
                        }

                        try {
                            const result = JSON.parse(stdout);
                            const variableItems = [];

                            for (const variableName in result.variables) {
                                if (result.variables.hasOwnProperty(variableName)) {
                                    const variable = result.variables[variableName];
                                    const completionItem = new vscode.CompletionItem(variableName, vscode.CompletionItemKind.Variable);
                                    completionItem.detail = `$${variable.type} (${variable.line + 1}:${variable.col})`;

                                    if (variableName.startsWith('@')) {
                                        completionItem.label = variableName.replace("@", "");
                                    }

                                    variableItems.push(completionItem);
                                }
                            }

                            for (const functionName in result.functions) {
                                if (result.functions.hasOwnProperty(functionName)) {
                                    const variable = result.functions[functionName];
                                    const completionItem = new vscode.CompletionItem(functionName, vscode.CompletionItemKind.Function);
                                    completionItem.detail = `$${variable.type} (${variable.line + 1}:${variable.col})`;

                                    if (functionName.startsWith('@')) {
                                        completionItem.label = functionName.replace("@", "");
                                    }

                                    variableItems.push(completionItem);
                                }
                            }

                            for (const structName in result.structs) {
                                if (result.structs.hasOwnProperty(structName)) {
                                    const variable = result.structs[structName];
                                    const completionItem = new vscode.CompletionItem(structName, vscode.CompletionItemKind.Struct);
                                    completionItem.detail = `${structName} (${variable.line + 1}:${variable.col})`;

                                    if (structName.startsWith('@')) {
                                        completionItem.label = structName.replace("@", "");
                                    }

                                    variableItems.push(completionItem);
                                }
                            }

                            [
                                ["int", vscode.CompletionItemKind.Struct, "Root integer type."],
                                ["float", vscode.CompletionItemKind.Struct, "Root floating point type."],
                                ["bool", vscode.CompletionItemKind.Struct, "Root boolean type."],
                                ["str", vscode.CompletionItemKind.Struct, "Root string type."],
                                ["null", vscode.CompletionItemKind.Struct, "Root null type."],
                                ["true", vscode.CompletionItemKind.Constant, "True boolean constant."],
                                ["false", vscode.CompletionItemKind.Constant, "False boolean constant."],

                            ].forEach(e => {
                                const completionItem = new vscode.CompletionItem(e[0], e[1]);
                                completionItem.detail = `${e[0]}: ${e[2]}`;
                                variableItems.push(completionItem);
                            });

                            resolve(variableItems);
                        } catch (e) {
                            vscode.window.showErrorMessage(`Error parsing LSP response: ${e.message}`);
                            reject(e);
                        }
                    });
                });
            });
        }
    });

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('termslang');

    const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId != "termslang")
            return;

        const filePath = document.uri.fsPath;

        // Clear existing diagnostics for the file
        diagnosticCollection.delete(vscode.Uri.file(filePath));

        exec(`${lspPath} lsp "${filePath}" 0 0 true`, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Error running LSP: ${stderr}`);
                return;
            }

            try {
                const result = JSON.parse(stdout);
                const diagnosticMap = new Map();

                if (result.errors) {
                    result.errors.forEach((error) => {
                        if (error.loc) {
                            const errorLocation = error.loc.match(/:(\d+):(\d+)-(\d+):(\d+)/);
                            const startLine = parseInt(errorLocation[1], 10) + 1;
                            const startCol = parseInt(errorLocation[2], 10);
                            const endLine = parseInt(errorLocation[3], 10) + 1;
                            const endCol = parseInt(errorLocation[4], 10);

                            const range = new vscode.Range(
                                new vscode.Position(startLine - 1, startCol - 1),
                                new vscode.Position(endLine - 1, endCol)
                            );

                            const diagnostic = new vscode.Diagnostic(range, error.msg, vscode.DiagnosticSeverity.Error);


                            const uri = vscode.Uri.file(error.loc.split(":")[0]);
                            if (!diagnosticMap.has(uri)) {
                                diagnosticMap.set(uri, []);
                            }

                            diagnosticMap.get(uri).push(diagnostic);
                        } else {
                            vscode.window.showErrorMessage(`Nonlocatable Error: ${error.msg}`);
                        }
                    });
                }

                diagnosticMap.forEach((diagnostics, uri) => {
                    diagnosticCollection.set(uri, diagnostics);
                });
            } catch (e) {
                vscode.window.showErrorMessage(`Error parsing LSP response: ${e.message}\n\n${stdout}`);
            }
        });
    });

    const formatDocument = vscode.languages.registerDocumentFormattingEditProvider('termslang', {
        provideDocumentFormattingEdits() {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return [];
            }

            return new Promise((resolve, reject) => {
                const document = editor.document;
                const filePath = document.uri.fsPath;
                const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));

                fs.writeFile(tempFilePath, document.getText(), (err) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Error writing temp file: ${err}`);
                        reject(err);
                        return;
                    }

                    exec(`${lspPath} format ${tempFilePath} true`, (error, stdout, stderr) => {
                        if (error) {
                            vscode.window.showErrorMessage(`Error formatting document: ${stderr}`);
                            reject(error);
                            reject();
                        }

                        resolve([
                            vscode.TextEdit.replace(
                                new vscode.Range(
                                    new vscode.Position(0, 0),
                                    new vscode.Position(document.lineCount, 0)
                                ),
                                stdout
                            )
                        ]);
                    });
                });
            });
        }
    });

    context.subscriptions.push(autoCompleteProvider, saveListener, diagnosticCollection, formatDocument);
}

exports.activate = activate;
