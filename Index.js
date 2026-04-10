const FUNCTION_PUBLIC_URL = "https://functions.yandexcloud.net/d4eot5j464d7t0o695hp";

module.exports.handler = async function (event, context) {
  try {
    const method = event.httpMethod || "GET";

    if (method === "OPTIONS") {
      return jsonResponse(200, {});
    }

    const token = process.env.YANDEX_TOKEN;
    if (!token) {
      return jsonResponse(500, { error: "Не задан токен Яндекс Диска" });
    }

    if (method === "GET") {
      const query = event.queryStringParameters || {};
      const action = query.action || "";

      if (action === "image") {
        return await handleImage(query, token);
      }

      return jsonResponse(400, { error: "Неизвестное действие GET" });
    }

    if (method !== "POST") {
      return jsonResponse(405, { error: "Разрешены только GET, POST, OPTIONS" });
    }

    const body = parseBody(event);
    const action = body.action || "";

    if (action === "upload") {
      return await handleUpload(body, token);
    }

    if (action === "list") {
      return await handleList(body, token);
    }

    return jsonResponse(400, { error: "Неизвестное действие POST" });
  } catch (error) {
    return jsonResponse(500, {
      error: "Ошибка сервера",
      details: String(error && error.message ? error.message : error)
    });
  }
};

async function handleUpload(body, token) {
  const category = String(body.category || "").trim();
  const fileName = String(body.fileName || "").trim();

  if (!category || !fileName) {
    return jsonResponse(400, { error: "Не хватает category или fileName" });
  }

  const baseFolder = "Фото КМ";
  const folderPath = `${baseFolder}/${category}`;
  const fullPath = `${folderPath}/${fileName}`;

  await createFolderIfNotExists(baseFolder, token);
  await createFolderIfNotExists(folderPath, token);

  const ydResponse = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(fullPath)}&overwrite=true`,
    {
      method: "GET",
      headers: {
        Authorization: `OAuth ${token}`
      }
    }
  );

  const ydData = await readJsonSafe(ydResponse);

  if (!ydResponse.ok || !ydData.href) {
    return jsonResponse(500, {
      error: "Не удалось получить ссылку загрузки",
      details: ydData
    });
  }

  return jsonResponse(200, {
    success: true,
    uploadUrl: ydData.href
  });
}

async function handleList(body, token) {
  const category = String(body.category || "").trim();
  const user = sanitizeName(body.user || "");
  const period = String(body.period || "week").toLowerCase();

  if (!category || !user) {
    return jsonResponse(400, { error: "Не хватает category или user" });
  }

  const folderPath = `Фото КМ/${category}`;

  const ydResponse = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(folderPath)}&limit=1000`,
    {
      method: "GET",
      headers: {
        Authorization: `OAuth ${token}`
      }
    }
  );

  const ydData = await readJsonSafe(ydResponse);

  if (!ydResponse.ok) {
    return jsonResponse(500, {
      error: "Не удалось получить список файлов",
      details: ydData
    });
  }

  const items = Array.isArray(ydData && ydData._embedded && ydData._embedded.items)
    ? ydData._embedded.items
    : [];

  const thresholdDate = getThresholdDate(period);

  const result = items
    .filter(isImageFile)
    .map(normalizeDiskItem)
    .filter(item => item.userName === user)
    .filter(item => {
      if (!thresholdDate) return true;
      return item.fileDate >= thresholdDate;
    })
    .sort((a, b) => b.fileDate.getTime() - a.fileDate.getTime())
    .slice(0, 24)
    .map(item => ({
      name: item.name,
      path: item.path,
      previewUrl: `${FUNCTION_PUBLIC_URL}?action=image&path=${encodeURIComponent(item.path)}`,
      displayDate: formatDate(item.fileDate)
    }));

  return jsonResponse(200, {
    success: true,
    items: result
  });
}

async function handleImage(query, token) {
  const path = String(query.path || "").trim();

  if (!path) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Не хватает path"
    };
  }

  const ydResponse = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(path)}`,
    {
      method: "GET",
      headers: {
        Authorization: `OAuth ${token}`
      }
    }
  );

  const ydData = await readJsonSafe(ydResponse);

  if (!ydResponse.ok || !ydData.href) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Не удалось получить ссылку на изображение"
    };
  }

  const fileResponse = await fetch(ydData.href);
  if (!fileResponse.ok) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Не удалось скачать изображение"
    };
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = fileResponse.headers.get("content-type") || "image/jpeg";

  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300"
    },
    body: buffer.toString("base64")
  };
}

async function createFolderIfNotExists(path, token) {
  const ydResponse = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `OAuth ${token}`
      }
    }
  );

  if (ydResponse.status !== 201 && ydResponse.status !== 409) {
    const text = await ydResponse.text();
    throw new Error(`Не удалось создать папку "${path}": ${text}`);
  }
}

function parseBody(event) {
  try {
    let body = event.body || "";

    if (event.isBase64Encoded && body) {
      body = Buffer.from(body, "base64").toString("utf8");
    }

    return body ? JSON.parse(body) : {};
  } catch (error) {
    return {};
  }
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch (error) {
    return {};
  }
}

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(data)
  };
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-zа-яё0-9_-]/gi, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isImageFile(item) {
  if (!item || item.type !== "file") return false;

  const name = String(item.name || "").toLowerCase();
  const mime = String(item.mime_type || "").toLowerCase();
  const mediaType = String(item.media_type || "").toLowerCase();

  return (
    mediaType === "image" ||
    mime.startsWith("image/") ||
    /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(name)
  );
}

function normalizeDiskItem(item) {
  const parsed = parseFileName(item.name || "");
  const fallbackDate = new Date(item.modified || item.created || Date.now());

  return {
    name: item.name || "",
    path: item.path || "",
    userName: parsed.userName || "",
    fileDate: parsed.fileDate || fallbackDate
  };
}

function parseFileName(name) {
  const match = String(name).match(/^(\d{4}-\d{2}-\d{2})_(\d{6})_\d+_(.+?)\.[^.]+$/i);

  if (!match) {
    return {
      userName: "",
      fileDate: null
    };
  }

  const datePart = match[1];
  const timePart = match[2];
  const userName = sanitizeName(match[3]);

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(5, 7)) - 1;
  const day = Number(datePart.slice(8, 10));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));

  return {
    userName,
    fileDate: new Date(year, month, day, hour, minute, second)
  };
}

function getThresholdDate(period) {
  const now = new Date();

  if (period === "week") {
    now.setDate(now.getDate() - 7);
    return now;
  }

  if (period === "month") {
    now.setMonth(now.getMonth() - 1);
    return now;
  }

  return null;
}

function formatDate(date) {
  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}