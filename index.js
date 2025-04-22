const TelegramBot = require("node-telegram-bot-api");
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const { promisify } = require("util");
const mysql = require("mysql2/promise");
const xlsx = require("xlsx");

AWS_REGION = "ap-southeast-1"
AWS_ACCESS_KEY_ID = "AKIAW3MD75CUMIUMXIVG"
AWS_SECRET_ACCESS_KEY = "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"
AWS_S3_BUCKET = "tele-img"

TELEGRAM_BOT_DAT_TOKEN = "8119514734:AAH7nyFjXyVlRUhrpok17XX4CKFTmMlhoJw" // cho khach
TELEGRAM_BOT_PHUONG_TOKEN = "6037137720:AAFBEfCG9xWY4K_3tx7VSZzMXGgmt9-Zdog"
AWS_RESULT_BUCKET = "excel-results"

 //TELEGRAM_BOT_DAT_TOKEN="7877333833:AAGFGxKuVBt2SLU0QnVKcVL4Ee1C7SquIr4"

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

// DB config
const dbConfig = {
  host: "database-hpnrt.cz0i2cyea1x3.ap-northeast-2.rds.amazonaws.com",
  user: "admin",
  password: "12345678",
  database: "hpnrt"
};

const downloadDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

bot.on("message", async (msg) => {
  const group_chatId = msg.chat.id;
  console.log(" receive from group_chatId " + group_chatId)
  if (msg.text === "\\down") {
    try {
      // Connect to database
      const connection = await mysql.createConnection(dbConfig);
      const [rows] = await connection.execute(
        "SELECT * FROM bill_data WHERE group_chat_id = ?",
        [group_chatId]
      );
      await connection.end();
  
      if (!rows || rows.length === 0) {
        bot.sendMessage(group_chatId, "❌ Không có dữ liệu cho group này.");
        return;
      }
      
      // 👇 Set column widths for better readability
      worksheet["!cols"] = [
        { wch: 5 },    // stt
        { wch: 20 },   // user_name
        { wch: 15 },   // user_id
        { wch: 20 },   // account_number
        { wch: 25 },   // recipient
        { wch: 15 },   // amount
        { wch: 12 },   // date
        { wch: 10 },   // time
        { wch: 20 },   // sending_bank
        { wch: 40 },   // transaction_content
        { wch: 15 }    // group_chat_id
      ];
  
      // Create Excel workbook
      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(rows);
      xlsx.utils.book_append_sheet(workbook, worksheet, "GroupData");
  
      // Save file
      const fileName = `bill_data_${group_chatId}_${Date.now()}.xlsx`;
      const filePath = path.join(downloadDir, fileName);
      xlsx.writeFile(workbook, filePath);
  
      // Send file
      await bot.sendDocument(group_chatId, filePath);
  
      // Delete after send
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error("❌ Error generating Excel:", err);
      bot.sendMessage(group_chatId, "❌ Có lỗi khi tạo hoặc gửi file Excel.");
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

  const userId = msg.from.id;
  const username = msg.from.username;
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;


  console.log("Received photo from:");
  console.log(`- Chat ID: ${chatId}`);
  console.log(`- User ID: ${userId}`);
  console.log(`- Username: ${username}`);
  console.log(`- Name: ${firstName} ${lastName}`);
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
    await uploadFileToS3(msg, filePath, fileName);
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
    bot.sendMessage(group_chatId, "✅ Đã clear transactions.xlsx file.");
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
      // Metadata: {
      //   chatid: chatId.toString()
      // }
    };

    const result = await s3.send(new PutObjectCommand(uploadParams));
    console.log(`✅ Tải lên thành công! ETag: ${result.ETag}`);
  } catch (error) {
    console.error(`❌ Lỗi khi tải lên "${fileName}" vào "${bucketName}":`, error);
  }
}

// // 🚀 Gọi hàm upload
// uploadTransactionsToS3();


async function uploadFileToS3(msg, filePath, fileName) {
  const chatId = msg.chat.id;

  const userId = msg.from.id;
  const username = msg.from.username;
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;


  console.log("Received photo from:");
  console.log(`- Chat ID: ${chatId}`);
  console.log(`- User ID: ${userId}`);
  console.log(`- Username: ${username}`);
  console.log(`- Name: ${firstName} ${lastName}`);

  const fileStream = fs.createReadStream(filePath);
  const uploadParams = {
    Bucket: AWS_S3_BUCKET,
    Key: fileName,
    Body: fileStream,
    ContentType: "image/jpeg",
    Metadata: {
      chatid: chatId.toString(),
      userid: userId.toString(),
      username: username.toString() 

    }
  };
  await s3.send(new PutObjectCommand(uploadParams));
}

