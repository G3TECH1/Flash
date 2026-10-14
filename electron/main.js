const path = require('path')
const {app, BrowserWindow} = require('electron')
const { startServer} = require("./server")

let mainWindow = null
let flashServer =null

function createWindow(){
    mainWindow = new BrowserWindow({
        width: 980,
        height: 730,
        webPrefrencce: (
            {
                contextIsolation: true,
                nodeIntegration: false,
            }
        )
        
    })

    mainWindow.loadFile(path.join(__dirname, '..', 'www',  'index.html'))
}

app.whenReady().then(()=>{
    flashServer = startServer()
    createWindow()
})

app.on('window-all-closed', ()=>{
    if(flashServer) flashServer.stop()
    if(process.platform !== 'darwin') app.quit()
})

app.on("before-quit", ()=>{
    if(flashServer) flashServer.stop()
})