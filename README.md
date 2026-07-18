# DVC Scraper - dichvucong.gov.vn

Công cụ cào toàn bộ 5665+ thủ tục hành chính từ [dichvucong.gov.vn](https://dichvucong.gov.vn/thu-tuc-hanh-chinh).

## Cấu trúc thư mục output

```
procedures/
  co-con-nho/              <- Folder cha (nhóm cuộc sống)
    1.001234/              <- Folder con (mã số thủ tục)
      procedure.json       <- Metadata + chi tiết thủ tục
      chi-tiet-thu-tuc-1.001234.pdf  <- PDF tổng hợp
      mau/
        TenMau.docx        <- Các file mẫu biểu (nếu có)
    1.002345/
      ...
  hoc-tap/
    ...
```

## Các nhóm (22 nhóm)

### CÔNG DÂN
- `co-con-nho` - Có con nhỏ
- `hoc-tap` - Học tập
- `viec-lam` - Việc làm
- `cu-tru-va-giay-to-tuy-than` - Cư trú và giấy tờ tùy thân
- `hon-nhan-va-gia-dinh` - Hôn nhân và gia đình
- `dien-luc-nha-o-dat-dai` - Điện lực, nhà ở, đất đai
- `suc-khoe-va-y-te` - Sức khỏe và y tế
- `phuong-tien-va-nguoi-lai` - Phương tiện và người lái
- `huu-tri` - Hưu trí
- `nguoi-than-qua-doi` - Người thân qua đời
- `giai-quyet-khieu-kien` - Giải quyết khiếu kiện

### DOANH NGHIỆP
- `khoi-su-kinh-doanh` - Khởi sự kinh doanh
- `lao-dong-va-bao-hiem-xa-hoi` - Lao động và bảo hiểm xã hội
- `tai-chinh-doanh-nghiep` - Tài chính doanh nghiệp
- `dien-luc-dat-dai-xay-dung` - Điện lực, đất đai, xây dựng
- `thuong-mai-quang-cao` - Thương mại, quảng cáo
- `so-huu-tri-tue-dang-ky-tai-san` - Sở hữu trí tuệ, đăng ký tài sản
- `thanh-lap-chi-nhanh-van-phong` - Thành lập chi nhánh văn phòng
- `dau-thau-mua-sam-cong` - Đấu thầu, mua sắm công
- `tai-co-cau-doanh-nghiep` - Tái cơ cấu doanh nghiệp
- `giai-quyet-tranh-chap-hop-dong` - Giải quyết tranh chấp hợp đồng
- `tam-dung-cham-dut-hoat-dong` - Tạm dừng, chấm dứt hoạt động

## Cách chạy

```bash
# Cài dependencies (1 lần)
npm install

# Cài Playwright browser (1 lần)
npx playwright install chromium

# Chạy scraper
node scraper.js
```

## Resume khi bị gián đoạn

Scraper tự động lưu tiến độ vào `scraper-state.json`. Khi chạy lại:
- Các folder đã có `procedure.json` → **bỏ qua**
- Các group đã hoàn thành → **bỏ qua**
- Tiếp tục từ `lastId` của group chưa xong

```bash
# Chạy lại - tự động resume
node scraper.js
```

## Xử lý lỗi

| File | Ý nghĩa |
|------|---------|
| `errors.txt` | Log tất cả lỗi |
| `{code}/khong-vao-duoc.txt` | Không lấy được chi tiết + URL |
| `{code}/pdf-link.txt` | PDF không tải được + link thủ công |
| `{code}/mau/` | Thư mục chứa file mẫu biểu |

## API (tham khảo)

Scraper dùng Playwright để bypass WAF, gọi API trong browser context:

| Endpoint | Mục đích |
|----------|---------|
| `POST /api/v1/submitting/formality/list-all-public-formality-by-citizen` | Lấy danh sách thủ tục |
| `POST /api/v1/configuring/formality/get-formality-by-citizen` | Chi tiết thủ tục |
| `POST /api/v1/configuring/formality/export-pdf-formality-detail-by-citizen` | Tải PDF thủ tục |
| `GET /api/v1/submitting/preview-attachment-by-citizen?fileId=xxx` | Tải file mẫu biểu |
