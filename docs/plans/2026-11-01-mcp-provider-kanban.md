# Vận hành department, MCP và Kanban

Ngày: 2026-11-01. Phạm vi: kiểm tra MCP Codex/Claude/Zcode/AGY, restart,
chuyển folder, xung đột, quyền riêng tư và quên dữ liệu của cơ chế hiện có.
Memory dự án và Cognee: **TẠM DỪNG**, không triển khai trong đợt này.

## Cách department vận hành

Mục tiêu là tiếp tục backlog đã được giao khi một task gặp lỗi. Không có cam
kết chạy vô hạn khi hết việc, hết ngân sách hoặc toàn bộ provider không dùng được.

`BACKLOG → READY → IMPLEMENTATION → REVIEW → DONE` là quy ước vận hành.
`WAITING_DEPENDENCY` áp dụng cho từng việc thiếu quyền, credential hoặc quyết
định bên ngoài; Chief tiếp tục việc READY độc lập. Đây chưa phải board UI mới:
API queue hiện vẫn dùng queued/running/completed/failed/interrupted.

Chief dùng `list_tasks` và `create_task` để duy trì backlog trong phạm vi được
quản lý. Mỗi task có owner, đầu vào, phạm vi file/artifact, điều kiện nghiệm thu,
bằng chứng cần có và dependency trong brief. Worker thực thi process đã cấu
hình. Một writer trên mỗi artifact; không giao hai bot sửa trùng file.
Queue cho phép bốn lane, mỗi bot một task; workflow graph đầy đủ vẫn chạy độc quyền.

Khi worker thiếu tool hoặc provider lỗi, goal coordinator nhận kết quả lỗi,
đối soát phần đã làm rồi đổi brief, đổi worker hoặc tự xử lý bằng tool phù hợp.
Reviewer thiếu file/shell phải được đổi cách kiểm tra, không lặp sửa sản phẩm
để chữa lỗi môi trường reviewer. Chỉ đánh dấu DONE với artifact và test evidence.

Queue lưu liên kết recovery cho task thất bại, giao một lần cho Chief có quyền
quản lý bot đó. Chief kiểm tra task/artifact trước khi tạo việc thay thế. Sau
restart, task đang chạy thành interrupted và được giao Chief đối soát; không
tự phát lại hành động có thể đã có tác dụng bên ngoài. Không có Chief phù hợp
thì item chờ, các task khác vẫn chạy. Recovery task lỗi không tự sinh chuỗi
recovery vô hạn; liên kết được giữ qua restart để tránh giao trùng.
Host không tự retry hoặc gửi thêm incident khi lượt chạy đã có process/queue
nhận kết quả và chịu trách nhiệm recovery. Test HTTP tái hiện và kiểm tra lỗi
hai nơi cùng tiếp nhận một task.

Giữ Stop, spend cap, giới hạn 13 turn của goal, retry hiện có và delegation depth
4. Hết giới hạn thì kết thúc lượt có lý do cụ thể; không vượt quyền hay tự bịa
backlog. Bot có thể chờ dependency thật, nhưng một item chờ không đóng department.

## Codex–Claude cùng phát triển

Đây là quy tắc bàn giao code, bổ trợ cho vận hành bot ở trên. Mỗi thẻ có một
người thực hiện và phạm vi file. Trước khi sửa, cập nhật owner và trạng thái.
Codex và Claude không sửa cùng file đồng thời; bên đến sau nhận thẻ độc lập.
Handoff gồm vấn đề, file sửa, lệnh test, evidence, giới hạn và bước tiếp theo.
Reviewer trả PASS hoặc NEEDS_CHANGES với lỗi tái hiện. Không ghi Claude đã
review khi chưa có kết quả thực tế. Không thêm gate xin phép ở từng bước.

## Bảng công việc

| ID | Công việc | Người thực hiện | Trạng thái | Hoàn tất khi |
| --- | --- | --- | --- | --- |
| OPS-1 | Department tiếp tục khi worker lỗi; recovery queue bền qua restart | Codex | REVIEW | Goal ba bot, task độc lập, Chief recovery một lần và không replay action pass |
| MCP-1 | Đối chiếu mount/scoping của bốn provider và agents proxy | Codex | REVIEW | Test catalog, phạm vi tool, credential và adapter pass |
| MCP-2 | Runner tái chạy và lưu evidence JSON/log | Codex | REVIEW | `scripts/verify-provider-mcp.ts` trả exit code test và ghi artifact |
| MCP-3 | Native Zcode loopback + AGY ACP initialize | Codex | REVIEW | Tách rõ native runtime, provider giả lập và authenticated provider |
| DUR-1 | Folder move + restart + conflict + private recall | Codex | REVIEW | Fixture riêng chứng minh cwd thực, hash, dữ liệu và cách ly bot |
| DUR-2 | Sửa conflict giả ở lần lưu MEMORY.md đầu tiên | Codex | REVIEW | Hai lượt ghi cùng hash: đúng một 200, một 409; bộ containment pass |
| PRIV-1 | Token lifecycle và forget hiện có | Codex | REVIEW | Thu hồi token, xóa topic sau restart, tombstone chống học lại pass |
| REV-1 | Review độc lập diff và evidence | Claude — chưa nhận | READY | Review các file dưới đây; PASS hoặc chỉ ra lỗi tái hiện |
| LIVE-1 | Bốn provider đăng nhập thật gọi MCP trong desktop | Chưa nhận | BACKLOG | Native authenticated turn + tool result + resume/Stop có evidence |

`REVIEW` là Codex đã triển khai và đang bàn giao; không đồng nghĩa đã có review
độc lập. LIVE-1 chưa được chứng minh bởi fake engine hoặc initialize.

## Handoff cho Claude

Đọc `AGENTS.md`, `docs/verification/README.md` và
`docs/verification/mcp-provider-continuity.md` trước khi kiểm tra.
Các thay đổi của đợt này:

- `server/group-goal-run.ts`: trả lỗi worker về coordinator để chọn hướng khác.
- `server/routes/workflows.ts`, `shared/workflow.ts`, `server/index.ts`: recovery
  được lưu và chỉ chuyển Chief có quyền, không đệ quy recovery task.
- `server/chief-of-staff.ts`, `server/incidents.ts`: vận hành backlog liên tục,
  cô lập dependency, đổi reviewer thiếu tool; giữ giới hạn và quyền hiện có.
- Các test goal, workflows, Chief và incidents kiểm tra hành vi trên.

- `server/memory-store.ts`: kiểm tra hash trước khi tạo workspace mặc định;
  vẫn resolve containment sau khi tạo thư mục, trước atomic write.
- `server/memory-capture-restart.e2e.test.ts`: thêm tình huống hai bot, hai
  writer, topic deletion, folder move, restart và kiểm tra cwd từ fake CLI.
- `server/drivers/agents-proxy.test.ts`: kỳ vọng catalog task/process hiện tại
  và phân biệt các tool process chỉ dành cho Chief.
- `server/drivers/antigravity.native.test.ts`: opt-in initialize bản ACP chính
  thức trong profile riêng, copy runtime vào fixture, không dùng đăng nhập thật.
- `scripts/verify-provider-mcp.ts`: chạy bộ qualification và lưu JSON/log.

Checkout có nhiều thay đổi process/computer use từ trước; không reset hay ghi
đè các thay đổi đó. Đối chiếu riêng với
[plan process](2026-10-31-transformer-kanban-handoff.md).

Điểm cần review kỹ: journal vẫn giữ nội dung để Undo; quên note không phải xóa
toàn bộ transcript/backups; đổi folder cần rebind rõ ràng; test scope bot riêng
không chứng minh project A/B cách ly trong cùng bot hoặc cùng team.

## Kết quả kiểm tra 2026-11-01

- Qualification bốn adapter/MCP và continuity: **25 file, 968 pass, 1 skip**;
  bật native Zcode loopback và AGY initialize. Chạy trước bản sửa recovery trùng.
- Regression sau bản sửa cuối: **6 file, 82 pass**, gồm server thật với ba bot,
  queue recovery một lần, task độc lập, goal reroute, host retry và computer use.
- `pnpm typecheck`, oxlint cho các file sửa và `git diff --check`: pass.
- [Evidence JSON](../verification/evidence/2026-11-01-department-mcp.json)
  ghi số liệu từng file và đường dẫn log gốc. Các nhóm test có phần trùng nhau,
  không cộng hai số thành tổng test duy nhất.

Chưa có bằng chứng bốn provider đăng nhập thật thao tác MCP trong desktop;
LIVE-1 còn BACKLOG. REV-1 chưa được Claude nhận hoặc review. Kanban ở đây là
quy ước vận hành và task queue, chưa thêm board UI với các cột mới.
