import { ChildProcess, fork } from "child_process";
import { join } from "path";
import { commands, ExtensionContext, ProgressLocation, TextDocumentContentProvider, Uri, ViewColumn, window, workspace, WorkspaceFolder } from "vscode";

const modulePath = join(__dirname, "..", "..", "node_modules", "ungit", "bin", "ungit");
let child: ChildProcess;

export class UngitTextDocumentContentProvider implements TextDocumentContentProvider {
    public provideTextDocumentContent(uri: Uri): string {
        const url = `http://localhost:8448/#/repository?path=${uri.fsPath}`;
        return `
        <div style="position: fixed; height: 100%; width: 100%; margin-left: -20px;">
            <iframe src="${url}" style="border: none;" height="100%" width="100%"></iframe>
        </div>
        `;
    }
}

/**
 * Determine the Ungit root from the current active file.
 * Let the user pick a workspace if there is no open file.
 */
function executeCommand(): void {
    const activeTextEditor = window.activeTextEditor;
    let workspaceFolderPromise: Thenable<WorkspaceFolder | undefined>;
    if (activeTextEditor && activeTextEditor.document.uri.scheme === "file") {
        workspaceFolderPromise = Promise.resolve(workspace.getWorkspaceFolder(activeTextEditor.document.uri));
    } else if (workspace.workspaceFolders && workspace.workspaceFolders.length === 1) {
        workspaceFolderPromise = Promise.resolve(workspace.workspaceFolders[0]);
    } else {
        workspaceFolderPromise = window.showWorkspaceFolderPick();
    }
    workspaceFolderPromise.then((workspaceFolder) => {
        if (typeof workspaceFolder === "undefined") {
            window.showErrorMessage("Can't open Ungit outside a workspace.");
        } else if (workspaceFolder.uri.scheme !== "file") {
            window.showErrorMessage("Can't open Ungit on remote workpaces.");
        } else {
            openInWorkspace(workspaceFolder);
        }
    }, () => {
        window.showErrorMessage("Can't open Ungit: Unable to determine workspace.");
    });
}

function openInWorkspace(workspaceFolder: WorkspaceFolder): void {
    const ungitUri = workspaceFolder.uri.with({scheme: "ungit"});
    const ungitTabTitle = `Ungit - ${workspaceFolder.name}`;
    window.withProgress({
        location: ProgressLocation.Notification,
        title: "Starting Ungit",
        cancellable: true,
    }, (progress, token) => {
        token.onCancellationRequested(() => {
            if (child) {
                child.kill();
            }
        });
        return new Promise((resolve, reject) => {
            child = fork(modulePath, ["--no-b", "--ungitVersionCheckOverride"], { silent: true });
            const showInActiveColumn = workspace.getConfiguration("ungit").get<boolean>("showInActiveColumn") === true;
            const viewColumn = showInActiveColumn ? ViewColumn.Active : ViewColumn.Beside;
            child.stdout.on("data", (message: Buffer) => {
                const started =
                    (message.toString().includes("## Ungit started ##")) ||
                    (message.toString().includes("Ungit server already running")) ||
                    (message.toString().includes("Error: listen EADDRINUSE 127.0.0.1:8448"));
                if (started) {
                    progress.report({
                        increment: 100,
                    });
                    commands.executeCommand("vscode.previewHtml", ungitUri, viewColumn, ungitTabTitle).then(() => {
                        resolve();
                    }, (reason: string) => {
                        window.showErrorMessage(reason);
                        reject();
                    });
                }
            });
        });
    });
}

export function activate(context: ExtensionContext): void {
    const provider = new UngitTextDocumentContentProvider();
    const registration = workspace.registerTextDocumentContentProvider("ungit", provider);
    const disposable = commands.registerCommand("extension.ungit", executeCommand);
    context.subscriptions.push(disposable, registration);
}

export function deactivate(): void {
    if (child) {
        child.kill();
    }
}
