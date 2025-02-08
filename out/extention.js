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

    const provider = vscode.languages.registerCompletionItemProvider('termslang', {
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
                                    completionItem.detail = `${variable.type} (${variable.line}:${variable.col})`;
                                    variableItems.push(completionItem);
                                }
                            }

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
                        const uri = vscode.Uri.file(filePath);
                        const errorLocation = error.loc.match(/:(\d+):(\d+)-(\d+):(\d+)/);
                        if (errorLocation) {
                            const startLine = parseInt(errorLocation[1], 10) + 1;
                            const startCol = parseInt(errorLocation[2], 10);
                            const endLine = parseInt(errorLocation[3], 10) + 1;
                            const endCol = parseInt(errorLocation[4], 10);

                            const range = new vscode.Range(
                                new vscode.Position(startLine - 1, startCol - 1),
                                new vscode.Position(endLine - 1, endCol)
                            );

                            const diagnostic = new vscode.Diagnostic(range, error.msg, vscode.DiagnosticSeverity.Error);

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

    context.subscriptions.push(provider, saveListener, diagnosticCollection, formatDocument);
}

exports.activate = activate;
