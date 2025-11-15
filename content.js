// content.js (hiển thị maxPages trong giao diện và cho phép chỉnh sửa)

let isCrawling = false;
let currentPage = 1;
let allJobs = [];
let maxPages = 5; // crawl tối đa 5 trang
let hasExported = false;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...args) {
  console.log("[Indeed Crawler]", ...args);
}

function createPanel() {
  if (document.querySelector("#indeed-crawler-panel")) return;

  const panel = document.createElement("div");
  panel.id = "indeed-crawler-panel";
  panel.innerHTML = `
    <div id="indeed-crawler-controls">
      <button id="indeed-start-btn">Bắt Đầu Thu Thập</button>
      <button id="indeed-reset-btn">Xóa Dữ Liệu</button>
      <label style="margin-left: 10px;">
        Số trang tối đa:
        <input type="number" id="max-pages-input" value="${maxPages}" min="1" style="width: 50px;"/>
      </label>
    </div>
    <div id="indeed-crawler-status">Chưa bắt đầu.</div>
    <div id="indeed-crawler-table-wrapper">
      <table id="indeed-crawler-table">
        <thead>
          <tr>
            <th>Company</th><th>Job Title</th><th>Link</th><th>Salary</th><th>Location</th><th>Page</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById("indeed-start-btn").onclick = () => {
    const inputVal = parseInt(document.getElementById("max-pages-input").value);
    if (!isNaN(inputVal) && inputVal > 0) {
      maxPages = inputVal;
      chrome.storage.local.set({ maxPages });
    }
    startCrawl();
  };

  document.getElementById("indeed-reset-btn").onclick = () => {
    chrome.storage.local.clear();
    allJobs = [];
    currentPage = 1;
    isCrawling = false;
    hasExported = false;
    document.querySelector("#indeed-crawler-table tbody").innerHTML = "";
    updateStatus("Đã xóa dữ liệu.");
    document.getElementById("indeed-start-btn").disabled = false;
  };
}

function updateStatus(text) {
  document.getElementById("indeed-crawler-status").textContent = text;
  log(text);
}

function appendToTable(job) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${job.company || "N/A"}</td>
    <td>${job.title || "N/A"}</td>
    <td><a href="${job.link}" target="_blank">Link</a></td>
    <td>${job.salary || "N/A"}</td>
    <td>${job.location || "N/A"}</td>
    <td>${job.page}</td>
  `;
  document.querySelector("#indeed-crawler-table tbody").appendChild(row);
}

async function startCrawl() {
  if (isCrawling) return;
  isCrawling = true;
  chrome.storage.local.set({ isCrawling, maxPages });
  document.getElementById("indeed-start-btn").disabled = true;
  updateStatus("Bắt đầu crawl...");
  await crawlLoop();
}

async function crawlLoop() {
  log("Crawl loop bắt đầu tại trang", currentPage);
  const success = await crawlPage();
  if (!success && isCrawling) {
    updateStatus("Chuyển trang, sẽ tiếp tục sau reload...");
  }
}

async function waitForJobCards(timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const cards = document.querySelectorAll("div.job_seen_beacon");
      if (cards.length > 0) {
        clearInterval(interval);
        log("Đã tìm thấy", cards.length, "job cards");
        resolve(cards);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject("Timeout đợi job card");
      }
    }, 500);
  });
}

async function crawlPage() {
  try {
    updateStatus(`Đang crawl trang ${currentPage}...`);
    const jobCards = await waitForJobCards();

    for (let i = 0; i < jobCards.length; i++) {
      if (!isCrawling) return false;

      const card = jobCards[i];
      card.scrollIntoView({ behavior: 'smooth' });
      await wait(1000);

      const titleLink = card.querySelector("h2.jobTitle a");
      if (titleLink) titleLink.click();
      await wait(3000);

      const job = {
        title: document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]')?.innerText?.trim() || "N/A",
        company: document.querySelector('[data-testid="inlineHeader-companyName"]')?.innerText?.trim() || "N/A",
        location: document.querySelector('[data-testid="inlineHeader-companyLocation"]')?.innerText?.trim() || "N/A",
        salary: document.querySelector('#salaryInfoAndJobType span')?.innerText?.trim() || "N/A",
        link: titleLink?.href || location.href,
        page: currentPage
      };

      allJobs.push(job);
      appendToTable(job);
      chrome.storage.local.set({ allJobs });
    }

    if (currentPage >= maxPages) {
      updateStatus("Đã đạt giới hạn số trang.");
      if (!hasExported) {
        exportCSV();
        hasExported = true;
      }
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
      return false;
    }

    const nextBtn = document.querySelector("a[aria-label='Next'], a[aria-label='Next Page'], a[data-testid='pagination-page-next']");

    if (nextBtn && !nextBtn.hasAttribute("aria-disabled")) {
      currentPage++;
      chrome.storage.local.set({ currentPage, allJobs, isCrawling, maxPages });
      nextBtn.scrollIntoView();
      nextBtn.click();
      return false;
    } else {
      updateStatus("Hoàn tất crawl tất cả trang.");
      if (!hasExported) {
        exportCSV();
        hasExported = true;
      }
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
      return false;
    }
  } catch (err) {
    console.error("Lỗi crawl page:", err);
    updateStatus("Lỗi crawl: " + err);
    return false;
  }
}

function exportCSV() {
  log("Bắt đầu xuất file CSV với", allJobs.length, "job");
  const headers = ["CompanyName", "Job Title", "Link", "Salary", "Location", "Page"];
  const rows = allJobs.map(j =>
    [j.company, j.title, j.link, j.salary, j.location, j.page].map(v => {
      const val = (typeof v === 'string' || typeof v === 'number') ? v.toString() : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(",")
  );

  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const jobCount = allJobs.length;
  const pageTitle = document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30);
  const filename = `${jobCount}_jobs_${pageTitle}.csv`;

  chrome.runtime.sendMessage({ action: "saveToCSV", url, filename });
}

chrome.storage.local.get(["allJobs", "currentPage", "isCrawling", "maxPages"], data => {
  if (Array.isArray(data.allJobs)) {
    allJobs = data.allJobs;
    data.allJobs.forEach(appendToTable);
    updateStatus(`Khôi phục ${allJobs.length} công việc đã lưu.`);
  }
  if (typeof data.currentPage === "number") {
    currentPage = data.currentPage;
  }
  if (typeof data.maxPages === "number") {
    maxPages = data.maxPages;
    const input = document.getElementById("max-pages-input");
    if (input) input.value = maxPages;
  }
  if (data.isCrawling) {
    isCrawling = true;
    waitForJobCards(15000).then(() => {
      crawlLoop();
    }).catch(err => {
      console.warn("Không thể tiếp tục vì không tìm thấy job cards:", err);
      updateStatus("Không thể tiếp tục vì không tìm thấy job cards.");
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
    });
  }
});

createPanel();
