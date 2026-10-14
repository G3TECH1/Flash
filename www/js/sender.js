async function sendFiles(targetUrl, fileList, token) {
  if (!fileList || fileList.length === 0) {
    throw new Error("Select at least one file");
  }

  if (!token) {
    throw new Error("Pair with the receiving PC first");
  }

  const base = targetUrl.replace(/\/+$/, "");
  const form = new FormData();

  for (const file of fileList) {
    form.append("files", file, file.name);
  }

  const response = await fetch(`${base}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Upload failed: ${response.status}`
    );
  }

  return response.json();
}

window.FlashSender = { sendFiles };