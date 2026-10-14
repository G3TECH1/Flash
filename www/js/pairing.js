async function readJson(res){
    const data = await res.json()

    if(!res.ok){
        throw new Error(data.error || `Request Failed: ${res.status}`)
    }
    return data;
}

async function getPairingCode(localServerUrl){
    const base = localServerUrl.replace(/\/+$/, "")
    const response = await fetch(`${base}/pairing-code`)
    const data = await readJson(response)

    return data.code
}

async function pairWithDevice(targetUrl, code){
    const base = targetUrl.replace(/\/+$/, "")
    const response = await fetch(`${base}/pair`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ code })
    })

    return readJson(response)
}

window.FlashPairing={
    getPairingCode,
    pairWithDevice
}



