# MCP provider và continuity

Mọi test dưới đây dùng HOME/data/profile tạm, server loopback và fake provider.
Không gửi mutation vào app đang dùng. Runner ghi `scope.json`, `results.json`
và `run.log` trong thư mục `omb-provider-mcp-evidence-*` được in lúc bắt đầu.

```sh
node --experimental-strip-types scripts/verify-provider-mcp.ts
```

Native Zcode chạy CLI thật, provider OpenAI giả lập localhost và một stdio MCP
thật. Nó kiểm tra tool call và resume cùng session; không chứng minh chất lượng
model hay tài khoản Zcode thật. Bật bằng `OMB_ZCODE_NATIVE_E2E=1`, tùy chọn
`OMB_ZCODE_CLI=/absolute/path/to/zcode`.

Native AGY chỉ initialize ACP và xác minh release/capability/auth method, không
đăng nhập hoặc gọi model. Bật bằng `OMB_AGY_NATIVE_E2E=1` và
`OMB_AGY_ACP_EXECUTABLE=/absolute/path/to/agy_acp_server.par` (Windows: `.exe`).
File `localharness_external` cùng release phải nằm cạnh executable. Test copy
hai file vào fixture trước khi chạy. Legacy `agy` không thay thế được official
ACP runtime. Hai native test mặc định SKIP; `scope.json` ghi rõ đã bật hay chưa.

## Những gì được kiểm tra

| Phạm vi | Bằng chứng |
| --- | --- |
| Codex | app-server fixture: custom MCP, collision naming, ambient MCP isolation, resume và lỗi mount |
| Claude | CLI fixture: strict config, tool search, MCP diagnostics, warm session và credential rotation |
| Zcode | adapter fixture + opt-in native loopback: settings riêng, selected MCP, tool call và resume |
| AGY | ACP fixture: scoped MCP, auth environment, pooled session/rotation; opt-in official initialize |
| Token | Credential chỉ hoạt động khi turn chạy; Stop, đổi approval và xóa bot thu hồi quyền |
| Conflict | Hai request cùng expectedHash: một lưu thành công, request cũ nhận 409; không ghi đè winner |
| Folder | Rename thư mục thật, rebind bot, tạo task với cwd mới; fake CLI báo cwd thực trước/sau restart |
| Restart | Restart đúng child với cùng data tạm; note/hash/topic deletion và cwd được giữ |
| Privacy | Bot B không nhận sentinel note của bot A; đường dẫn vượt workspace bị từ chối |
| Forget | Xóa topic không còn được recall sau restart; upkeep tombstone không tự học lại fact đã quên |

Folder test chứng minh chuyển thư mục sau khi công việc đã settled và rebind
tường minh. Không chứng minh tự tìm thư mục bị move, chuyển app data, hay move
trong lúc CLI đang chạy. Privacy ở đây là scope bot và credential, không phải
sandbox filesystem khi bot được cấp full shell/computer access.

## Department không dừng vì một item lỗi

Runner bao gồm unit và HTTP E2E cho goal coordinator, durable task queue,
Chief, incidents và bounded waits. Fixture ba bot dùng CLI giả lập: reviewer
đầu crash, coordinator đổi reviewer và nhận evidence. Nó chứng minh điều phối,
không chứng minh browser/computer thực sự đã thao tác.

Queue test kiểm tra worker lỗi, task độc lập vẫn hoàn tất, Chief giao worker
thay thế, restart không giao recovery trùng; task đang chạy khi restart chỉ
được đối soát, không tự replay. Recovery Chief lỗi không sinh recovery mới;
Chief không khả dụng không chặn task khác. Stop và giới hạn vẫn có hiệu lực.
HTTP E2E còn kiểm tra host không tạo thêm Team incidents hoặc tự nhận recovery
khi queue/process đã nhận kết quả của lượt chạy. Retry của chat thông thường
được kiểm tra riêng để giữ hành vi đó.

Kết quả ngày 2026-11-01: qualification 25 file **968 pass, 1 skip** trước bản
sửa recovery trùng; regression bản cuối 6 file **82 pass**; typecheck và lint
các file sửa pass. [Evidence theo file](evidence/2026-11-01-department-mcp.json).
Hai bộ có test trùng, không cộng thành tổng test duy nhất.

## Giới hạn quên dữ liệu

Memory hiện có là Markdown theo bot, journal, lexical recall và lịch sử chat;
không có Cognee hay kho context theo project được thêm trong đợt này. Note
deletion loại khỏi note recall. Journal có thể giữ bản trước để Undo; API
journal giấu trường `before`, nhưng diff vẫn chứa phần đã xóa cho người có
quyền xem lịch sử. Đây không phải hard erase trên disk.
`memory_update forget` bỏ nội dung khỏi note/topic/About me và chống upkeep
học lại; nó không xóa transcript, bản export hoặc backup. Lịch sử chat có thể
vẫn chứa fact cũ. Không tuyên bố đáp ứng yêu cầu xóa dữ liệu toàn diện bằng
các test hiện tại.

Kanban và handoff độc lập:
[Vận hành department và Kanban](../plans/2026-11-01-mcp-provider-kanban.md).
