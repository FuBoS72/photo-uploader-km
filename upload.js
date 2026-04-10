export default async function handler(req, res) {
  const TOKEN = process.env.YANDEX_TOKEN;

  if (!TOKEN) {
    return res.status(500).send("Не задан токен Яндекс Диска");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Only POST");
  }

  try {
    const { category, fileName } = req.body;

    if (!category || !fileName) {
      return res.status(400).send("Не хватает данных");
    }

    const baseFolder = "Фото КМ";
    const folderPath = `${baseFolder}/${category}`;
    const fullPath = `${folderPath}/${fileName}`;

    await createFolderIfNotExists(baseFolder, TOKEN);
    await createFolderIfNotExists(folderPath, TOKEN);

    const uploadUrlResponse = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(fullPath)}&overwrite=true`,
      {
        method: "GET",
        headers: {
          Authorization: `OAuth ${TOKEN}`
        }
      }
    );

    const uploadUrlData = await uploadUrlResponse.json();

    if (!uploadUrlResponse.ok || !uploadUrlData.href) {
      const errorText = JSON.stringify(uploadUrlData);
      return res.status(500).send("Не удалось получить ссылку загрузки: " + errorText);
    }

    return res.status(200).json({
      success: true,
      uploadUrl: uploadUrlData.href
    });
  } catch (error) {
    return res.status(500).send("Ошибка сервера: " + error.message);
  }
}

async function createFolderIfNotExists(path, token) {
  const response = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `OAuth ${token}`
      }
    }
  );

  if (response.status !== 201 && response.status !== 409) {
    const text = await response.text();
    throw new Error(`Не удалось создать папку "${path}": ${text}`);
  }
}
