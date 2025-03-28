const TelegramBot = require("node-telegram-bot-api");
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const { promisify } = require("util");

AWS_REGION="ap-southeast-1"
AWS_ACCESS_KEY_ID="AKIAW3MD75CUMIUMXIVG"
AWS_SECRET_ACCESS_KEY="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"
AWS_S3_BUCKET="tele-img"
// TELEGRAM_BOT_DAT_TOKEN="7877333833:AAGFGxKuVBt2SLU0QnVKcVL4Ee1C7SquIr4"
 TELEGRAM_BOT_DAT_TOKEN="8119514734:AAH7nyFjXyVlRUhrpok17XX4CKFTmMlhoJw" // khach
TELEGRAM_BOT_PHUONG_TOKEN="6037137720:AAFBEfCG9xWY4K_3tx7VSZzMXGgmt9-Zdog"

AWS_RESULT_BUCKET="excel-results"



BOT_TOKEN = TELEGRAM_BOT_DAT_TOKEN;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
// const chatId = "-4613288345";
console.log("bot dang chay");

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});


const downloadDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

bot.on("message", async (msg) => {
  const group_chatId = msg.chat.id;
  if (msg.text === "\\down") {
    try {
      const listCommand = new ListObjectsV2Command({ Bucket: AWS_RESULT_BUCKET });
      const { Contents } = await s3.send(listCommand);

      if (!Contents || Contents.length === 0) {
        bot.sendMessage(group_chatId, "❌ Không có file nào trong bucket.");
        return;
      }

      for (const file of Contents) {
        const fileKey = file.Key;
        const localFilePath = path.join(downloadDir, path.basename(fileKey));

        await downloadFileFromS3(fileKey, localFilePath);
        await bot.sendDocument(group_chatId, localFilePath);
        fs.unlinkSync(localFilePath);
      }
    } catch (error) {
      console.error("❌ Lỗi khi tải file:", error);
      bot.sendMessage(group_chatId, "❌ Có lỗi xảy ra khi tải file từ S3.");
    }
  }
  else if (msg.text === "\\clear") {
  
    try {
      const listCommand = new ListObjectsV2Command({ Bucket: AWS_RESULT_BUCKET });
      const { Contents } = await s3.send(listCommand);

      if (!Contents || Contents.length === 0) {
        console.log("✅ Bucket đã trống.");


        uploadTransactionsToS3(group_chatId)
        return;
      }

      const deleteParams = {
        Bucket: AWS_RESULT_BUCKET,
        Delete: {
          Objects: Contents.map(file => ({ Key: file.Key })),
        },
      };

      await s3.send(new DeleteObjectsCommand(deleteParams));
      console.log("✅ Đã xoá tất cả các file trong bucket.");


      uploadTransactionsToS3(group_chatId)
    } catch (error) {
      console.error("❌ Lỗi khi xoá file:", error);
      console.log("❌ Có lỗi xảy ra khi xoá file trong bucket.");
    }
  }
});


async function downloadFileFromS3(fileKey, filePath) {
  const command = new GetObjectCommand({ Bucket: AWS_RESULT_BUCKET, Key: fileKey });
  const { Body } = await s3.send(command);

  const streamPipeline = promisify(pipeline);
  await streamPipeline(Body, fs.createWriteStream(filePath));
}


bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  console.log(" receive from chatID "+ chatId)
  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileInfo = await bot.getFile(fileId);

    console.log("File Info:", fileInfo);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_DAT_TOKEN}/${fileInfo.file_path}`;
    console.log(" fileUrl " + fileUrl)
    console.log("File Path:", fileInfo.file_path);
    console.log("File URL:", fileUrl);

    const fileExtension = path.extname(fileInfo.file_path);
    console.log(" fileExtension " + fileExtension)
    const fileName = `uploads/${chatId}_${Date.now()}${fileExtension}`;
    const filePath = path.join(__dirname, fileName);

    await retryDownload(fileUrl, filePath);
    await uploadFileToS3(filePath, fileName);
    fs.unlinkSync(filePath);
    bot.sendMessage(chatId, `✅ Ảnh đã được tải lên`);
    // bot.sendMessage(chatId, `✅ Ảnh đã được tải lên S3:\nhttps://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`);
  } catch (error) {
    console.error("❌ Lỗi:", error);
    bot.sendMessage(chatId, "❌ Có lỗi xảy ra khi xử lý ảnh.");
  }
});

async function retryDownload(url, filePath, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await axios({ url, responseType: "stream" });
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    } catch (error) {
      console.error(`❌ Lỗi khi tải ảnh (thử lần ${i + 1}):`, error);
      if (i === attempts - 1) throw error;
    }
  }
}

async function uploadTransactionsToS3(group_chatId) {
  try {
    // 📂 Lấy đường dẫn tuyệt đối của file transactions.xlsx
    const filePath = path.join(__dirname, "transactions.xlsx");
    const fileName = "transactions.xlsx"; // Cố định tên file khi upload

    console.log(`📂 Đang kiểm tra file: ${filePath}`);

    // 📌 Kiểm tra file có tồn tại không
    if (!fs.existsSync(filePath)) {
      console.error("❌ Không tìm thấy transactions.xlsx để tải lên.");
      return;
    }

    console.log("🚀 Đang tải lên transactions.xlsx...");

    // 🆙 Tải file lên S3
    await uploadExelFileToS3(filePath, fileName, AWS_RESULT_BUCKET, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    console.log("✅ Đã tải lên transactions.xlsx vào bucket.");
    bot.sendMessage(group_chatId,"✅ Đã clear transactions.xlsx file.");
  } catch (error) {
    console.error("❌ Lỗi khi tải lên transactions.xlsx:", error);
  }
}

// 🆙 Hàm upload file lên S3
async function uploadExelFileToS3(filePath, fileName, bucketName, contentType) {
  try {
    const fileStream = fs.createReadStream(filePath);

    const uploadParams = {
      Bucket: bucketName,
      Key: fileName, // 📌 Cố định file name trên S3 là transactions.xlsx
      Body: fileStream,
      ContentType: contentType,
    };

    const result = await s3.send(new PutObjectCommand(uploadParams));
    console.log(`✅ Tải lên thành công! ETag: ${result.ETag}`);
  } catch (error) {
    console.error(`❌ Lỗi khi tải lên "${fileName}" vào "${bucketName}":`, error);
  }
}

// // 🚀 Gọi hàm upload
// uploadTransactionsToS3();


async function uploadFileToS3(filePath, fileName) {
  const fileStream = fs.createReadStream(filePath);
  const uploadParams = {
    Bucket: AWS_S3_BUCKET,
    Key: fileName,
    Body: fileStream,
    ContentType: "image/jpeg",
  };
  await s3.send(new PutObjectCommand(uploadParams));
}

