# Cognee cho context và memory dự án

Ngày: 2026-11-01. Trạng thái: **TẠM DỪNG theo yêu cầu; chỉ giữ bản thiết kế, không triển khai Cognee hay memory dự án**.
Người dùng yêu cầu lên plan trước. Thứ tự thực thi và phạm vi shared learning mới
nằm ở [plan Cognee shared learning](2026-11-01-cognee-shared-learning-memory.md).
Kiểm tra cơ chế MCP đang có vẫn theo [Kanban MCP](2026-11-01-mcp-provider-kanban.md).
Áp dụng cho OpenMausBot/open-team và các dự án mà team bot làm việc trên đó.
Liên quan: [plan process/Kanban Codex–Claude](2026-10-31-transformer-kanban-handoff.md).

## 1. Kết quả cần đạt

Một bot mới hoặc một provider mới tiếp nhận được mục tiêu, quyết định, công việc
đang dở, artifact và bằng chứng kiểm tra của đúng dự án. Ba bot phối hợp qua
process dùng cùng revision của context; đổi folder hoặc restart không mất liên hệ.
Người dùng xem, sửa, quên và export memory được.

Cognee hỗ trợ truy hồi liên quan giữa tài liệu, quyết định, code và kết quả chạy.
Process engine vẫn quản lý task, dependency, retry, verdict và trạng thái Kanban.
Memory không được tự cấp quyền tool, bật computer use, hay biến một claim thành PASS.

## 2. Hiện trạng đã đối chiếu source

| Thành phần | Hiện có | Cách sử dụng trong plan |
| --- | --- | --- |
| Memory riêng bot | `server/memory-store.ts`, `docs/memory.md`: Markdown, journal, giới hạn prompt, chống ghi đè | Giữ làm nguồn gốc; không gom vào kho public |
| Team memory | `server/team-memory.ts`: accepted/proposed/superseded/deleted, revision, nguồn | Tái sử dụng trạng thái và chính sách acceptance hiện hành |
| Recall tự động | `autoRecallPrompt` trong `server/index.ts`, có đường chat và room riêng | Ghép recall dự án tại nơi tạo context, trước khi gọi provider |
| Continuity provider | `server/turn-context.ts`: fresh/resume/recovery | Context dự án được dựng từ harness, không lệ thuộc session CLI |
| Process | `shared/bot-design.ts`, `shared/process-run.ts`, coordinator và process tools | Gắn project/revision/run/step vào bàn giao và evidence |
| MCP theo lượt | `server/drivers/agents-mcp-env.ts` và driver tương ứng | Đưa tool dự án có scope vào cơ chế hiện có |

Chưa có kết quả benchmark hoặc tích hợp Cognee trong checkout này. Test provider
Zcode/AGY và việc ba bot thực sự phối hợp vẫn là hạng mục nghiệm thu; các lần chạy
ba process riêng lẻ không thay thế được bài test ba bot giao việc qua lại.

## 3. Căn cứ kỹ thuật và quyết định

Cognee có memory API `remember`, `recall`, `forget`, cùng MCP; API Mode cho nhiều
client dùng chung backend. Plan chọn **một dịch vụ Cognee do harness quản lý**,
bot truy cập qua harness. Không khởi động một kho embedded độc lập cho mỗi CLI.
[Nguồn: Cognee MCP](https://docs.cognee.ai/cognee-mcp/mcp-overview).

Session memory và permanent graph có vòng đời khác nhau; ghi session không đủ
chứng minh đã lưu bền. Embedded stores không được nhiều tiến trình mở chung.
POC dùng một tiến trình sở hữu toàn bộ store, mọi truy cập qua API; trước khi mở
cho nhiều worker/process phải xác minh topology được bản pin hỗ trợ, hoặc dùng
external stores theo hướng dẫn. Không cho ba CLI mở trực tiếp cùng thư mục DB.
[Nguồn: Remember](https://docs.cognee.ai/core-concepts/main-operations/remember).

Code search là khả năng upstream cần đánh giá riêng. MVP bắt đầu với docs, memory
và artifact; chỉ thêm code graph khi chứng minh tốt hơn baseline `rg`/đọc file.
[Nguồn: MCP server README](https://github.com/topoteretes/cognee/blob/main/cognee-mcp/README.md).

Các mục còn lại là thiết kế đề xuất của OpenMausBot, không phải cam kết của Cognee.
Phase C0 phải pin phiên bản package/image và API thực tế; không dùng tag `main`
cho bản triển khai. Chưa chọn số phiên bản khi chưa chạy compatibility probe.

## 4. Các lớp context và memory

| Lớp | Nội dung | Nguồn gốc và phạm vi |
| --- | --- | --- |
| Working context | Yêu cầu hiện tại, task, revision, bước chạy, tool khả dụng | Dựng mới mỗi turn; task/runtime là nguồn gốc |
| Session/checkpoint | Đã làm gì, còn gì, blocker, bàn giao | Lưu bền ở harness trước; có thể index sang Cognee |
| Project memory | Quyết định, glossary, kiến trúc, constraints, lỗi đã xác minh | Record có revision và nguồn; chia sẻ cho thành viên dự án |
| Evidence | Lệnh test, exit code, thời gian, revision, artifact/hash | Artifact và run record là nguồn gốc; Cognee chỉ giúp tìm |
| Bot private memory | Ghi chú riêng và chat riêng | Giữ cơ chế hiện có; không tự chuyển sang project memory |
| Team/user memory | Thông tin chung và sở thích người dùng | Giữ scope hiện có; chỉ index phần được phép |

Graph/vector là chỉ mục có thể dựng lại. File, structured record và journal là dữ
liệu gốc. Chat riêng, room giới hạn thành viên và memory của dự án khác không
được trộn vào một dataset chỉ vì cùng model hoặc cùng folder cha.

## 5. Định danh và contract dữ liệu

Thêm `projectId` bất biến do harness cấp; không lấy absolute path hoặc tên thư
mục làm identity. Registry nằm trong data directory của OpenMausBot, lưu roots,
thành viên và policy. Manifest portable trong repo chỉ chứa ID/schema, không chứa
token hoặc DB. Khi manifest được copy sang repo khác, UI yêu cầu chọn liên kết
dự án cũ hay tạo dự án mới; không tự suy luận cùng identity từ remote URL.

Record tối thiểu:

```text
id, projectId, scope, kind, status, revision
source { type, relativePath?, messageId?, artifactId?, commit?, contentHash }
runId?, stepId?, authorBotId?, createdAt, updatedAt
supersedes?, expiresAt?, evidenceRefs[]
```

`kind`: decision, constraint, glossary, checkpoint, verifiedOutcome, sourceDoc.
`status`: proposed, accepted, superseded, deleted. Capability quan sát được lưu
theo provider/version và có hạn dùng; phải probe lại khi runtime thay đổi.

Dataset names được harness map từ project/scope, client không được tự gửi tên
dataset để vượt quyền. ID record cùng revision/hash là khóa chống index trùng.
Git SHA đi cùng hash working tree/artifact vì công việc có thể chưa commit.

## 6. Luồng ghi, truy hồi và sửa memory

### Ghi

1. Ghi file/record/journal gốc atomically; trả kết quả lưu gốc riêng với index.
2. Transaction/outbox lưu job index bền cùng thay đổi record. Nếu store hiện tại
   là file, thiết kế recovery từ journal, tránh khoảng trống giữa ghi file và enqueue.
3. Worker lọc secret, áp scope, gửi bản snapshot đã chuẩn hóa tới Cognee.
4. Chỉ đánh dấu indexed khi pipeline hoàn tất; retry có backoff và hủy được.
5. Khi sửa record, revision mới thay thế revision cũ; query phải loại bản cũ ngay
   ở harness kể cả khi backend đang chậm cập nhật.

Decision áp dụng acceptance policy hiện có. Checkpoint và evidence máy kiểm tra
được tự lưu trong scope đã cấp, không cần thêm owner gate mỗi bước. Claim của bot
chưa có evidence giữ ở trạng thái proposed/unverified, không tự quảng bá thành fact.

### Truy hồi

1. Resolve project + membership + scope từ request đã xác thực.
2. Lấy task/current step, acceptance và handoff trực tiếp từ runtime.
3. Query Cognee với dataset cho phép; kết hợp baseline keyword hiện có.
4. Đối chiếu hit với record gốc: quyền hiện tại, revision, tombstone, expiry, hash.
5. Dedupe và xếp hạng theo mức liên quan, revision, loại nguồn; không lấy mới nhất
   làm đúng nhất nếu decision cũ vẫn còn hiệu lực.
6. Đưa vào context packet có nguồn, giới hạn token và trạng thái freshness.

Mục tiêu ban đầu: tối đa 2.000 token recall bổ sung; timeout 1,5 giây khi index đã
ấm. Đây là ngân sách cần đo, chưa phải số hiệu năng đã đạt. Timeout/không có hit
thì dùng baseline; ghi rõ thiếu ngữ cảnh khi việc tiếp tục cần một nguồn bắt buộc.
Không để lỗi memory tự biến thành blocker thiếu shell/computer use.

Text truy hồi là dữ liệu tham khảo, không phải instruction. Lệnh nằm trong file,
webpage hoặc memory không được ghi đè policy và quyền hiện hành.

### Sửa, quên và backup

Sửa theo expected revision, trả conflict nếu stale. Forget tạo tombstone ở nguồn
gốc trước để ngừng recall ngay, rồi xóa index/cache/session liên quan qua job.
Xóa raw bytes và backup là thao tác có phạm vi riêng, UI phải nêu rõ. Cognee
`forget` không mặc nhiên xóa file raw trên disk.
[Nguồn: Forget](https://docs.cognee.ai/core-concepts/main-operations/forget).

Restore gồm registry, records, journal, artifacts và tombstones. Có thể dựng lại
index khi mất backend; kiểm tra round trip cả scope và các record đã bị quên.
Tắt project memory ngừng capture/recall và tool memory của dự án ở turn mới;
các file đã có vẫn xem được, không tự xóa. Cần nói rõ filesystem tool vẫn có thể
đọc file theo quyền được cấp, tương tự memory riêng bot hiện nay.

## 7. Phối hợp ba bot và process mở

Recipe mặc định: **Chief → Builder → Reviewer → Chief**. Bot ID/provider là
mapping chỉnh được; không hard-code Codex/Claude/Zcode/AGY vào vai trò.

1. Chief nhận mục tiêu, lấy project context, tạo task và chốt acceptance.
2. Builder nhận context packet + input revision, sửa phạm vi được giao, chạy test,
   ghi artifact/checkpoint có hash. Một writer cho cùng tập file.
3. Reviewer đọc cùng snapshot artifact, tự chạy kiểm tra, trả verdict + evidence.
   Không dùng câu “đã test” trong memory thay cho chạy test của revision hiện tại.
4. FAIL trả feedback về Builder theo loop đã cấu hình; hết vòng về Chief với
   blocker cụ thể. PASS về Chief tổng hợp và cập nhật verifiedOutcome.

Mỗi bàn giao mang `projectId/runId/stepId/inputRevision`, artifact refs và việc
còn lại. Trước khi review phải xác minh workspace khớp snapshot; nếu lệch thì
review snapshot riêng hoặc yêu cầu tạo revision mới. Không review nhầm live files.

Nhánh review có thể chạy song song khi thêm bot; join theo process engine hiện có.
Memory không tạo thêm một chuỗi gate. Owner chỉ duyệt nơi process hoặc quyền
hiện hành yêu cầu; không thêm “duyệt memory” vào mọi bước code/test.

Di chuyển root: người dùng relink root với projectId cũ, validate manifest và
fingerprint; relative paths được resolve lại, checkpoint/evidence vẫn giữ ID.
Repo khác cùng tên không được tự gắn. Worktree dùng chung decision memory nhưng
code/evidence luôn phân biệt branch/revision/worktree.

## 8. MCP và provider

MVP dùng tool bridge hiện có của OpenMausBot, server gọi Cognee API. Không đưa
admin token Cognee hoặc tool `forget everything` trực tiếp cho từng bot. Tên tool
dự kiến: `project_context`, `project_memory_search`, `project_memory_write`,
`project_checkpoint`; chốt lại sau khi kiểm tra catalog để tránh trùng công cụ.

Automatic context injection phải hoạt động cả khi CLI không gọi được MCP. Tool
search/write là đường tương tác bổ sung; write vẫn cần actor/project scope do
harness xác định. Không cài plugin memory upstream đồng thời với cơ chế tự capture
của harness trong MVP, tránh hai bên ghi trùng và bỏ qua policy.

| Provider | Cần chứng minh |
| --- | --- |
| Codex / Claude | Context packet, MCP scoped search/write, resume và chuyển provider |
| Zcode | Native CLI per-turn settings, tool call và session resume; Full access theo giới hạn driver hiện có |
| AGY/Antigravity | ACP initialize/session, MCP mount, permission lifecycle, cancel và resume |

Tách ba mức bằng chứng: scripted fixture; native CLI với loopback provider;
provider/model thật. Không gọi bài loopback là đã kiểm tra model thật. Khi thiếu
auth/tool, ghi đúng bước bị thiếu thay vì kết luận Cognee không tương thích.

Theo dõi riêng thời gian khởi động CLI, MCP handshake, backend recall và indexing.
Log có request ID, project/run/step và error class, không có token hay raw private
text. Bài test cần restart bridge/backend, timeout, token rotation và turn cancel.
Chưa có kết luận lỗi MCP chập chờn nằm ở tầng client.

## 9. Triển khai theo Kanban, chia việc Codex/Claude

Chỉ claim một task READY; ghi owner và phạm vi file trước khi sửa. Các dòng dưới
chưa được giao cho phiên agent đang chạy. Người review không tự coi tác giả đã
hoàn tất chỉ vì task chuyển trạng thái.

| ID | Deliverable | Người đề xuất | Phụ thuộc | Trạng thái |
| --- | --- | --- | --- | --- |
| C0 | Fixture Cognee pin version, health/auth, round trip docs + metadata + delete; đo RAM/disk/cold start trên Mac ARM | Codex | — | READY |
| C1 | Contract project identity/scope/record, registry + portable manifest, relocation/copy semantics | Claude | C0 | BACKLOG |
| C2 | Adapter/API, outbox/recovery, idempotency, revision/tombstone filtering và fallback | Codex | C1 | BACKLOG |
| C3 | Context packet và process handoff, bounded retrieval, chống prompt injection | Claude | C2 | BACKLOG |
| C4 | MCP scoped tools + provider qualification Codex/Claude/Zcode/AGY | Codex | C3 | BACKLOG |
| C5 | Project Memory UI: enable, sources, freshness, sửa/quên/export, relink root | Claude | C3 | BACKLOG |
| C6 | Ba bot thực tế, outage/restart/move folder, đối chiếu baseline, review chéo | Codex + Claude | C4, C5 | BACKLOG |

C0 chưa cần UI graph explorer, Redis, distributed workers hoặc Postgres graph.
Nếu bản pin không hỗ trợ topology embedded một service như dự kiến, ghi rõ kết
quả và chọn backend được hỗ trợ trước C1; không tự mở rộng hạ tầng toàn app.
Model extraction/embedding và đường dữ liệu ra ngoài phải explicit. Có thể thử
local models theo upstream, nhưng phải đo accuracy/cost; CLI subscription của
Zcode/AGY không mặc nhiên là credential LLM/embedding cho Cognee.
[Nguồn: upstream quickstart](https://github.com/topoteretes/cognee#quickstart).

## 10. Nghiệm thu bắt buộc trong fixture riêng

Theo [verification README](../verification/README.md), dùng temporary HOME/data,
root dự án và Cognee store riêng; tất cả mutation có URL fixture explicit.
Không index live project/chat/key của người dùng để làm bài test.

| Case | Bằng chứng phải có |
| --- | --- |
| Lưu và restart | Ghi decision, stop/start harness + Cognee, bot khác tìm đúng record/source |
| Private scope | Bot B không tìm được private memory của A hoặc dự án khác, kể cả hỏi đúng nguyên văn |
| Correction race | Hai bot sửa cùng revision: một thành công, một conflict; recall chỉ trả revision còn hiệu lực |
| Forget | Tombstone chặn recall khi Cognee offline; sau reconnect không phục hồi từ retry/cache/restore |
| Move/copy | Relink folder vẫn cùng ID; copy thành dự án mới không rò memory; worktree không lẫn evidence |
| Normal | Chief giao Builder, Reviewer PASS, Chief nhận đủ artifact + evidence |
| Hard | Reviewer FAIL ở vòng đầu, feedback đến Builder, revision mới PASS rồi về Chief |
| Complex | Browser tìm docs/video, lưu title/URL/ngày/nguồn; sửa app + browser test; restart và chuyển provider giữa chừng vẫn tiếp tục đúng bước |
| Outage | Cognee/MCP timeout, bridge restart, cancel: task dùng fallback hoặc báo nguồn bắt buộc đang thiếu, không tự tạo PASS |
| Untrusted text | Tài liệu chứa “bỏ qua policy” không làm đổi quyền hay ghi shared fact tự động |

Chạy ma trận ba bot với Terra trước, sau đó thay lần lượt Builder/Reviewer bằng
Zcode và AGY. Thu evidence native/provider thật riêng. Video URL/title không phải
bằng chứng đã xem nội dung; nếu acceptance cần nội dung video phải có playback/
transcript đã kiểm tra.

Tạo bộ 20 câu hỏi có đáp án/source IDs từ fixture: decision mới/cũ, code location,
checkpoint, evidence, negative scope và contradiction. Mục tiêu MVP: ít nhất 18/20
trả được nguồn đúng trong top 5; 0 hit vượt scope/đã quên/superseded. So baseline
keyword với Cognee trên cùng corpus; đo p50/p95 warm recall, cold start, token,
chi phí và RAM. Chưa đạt thì giữ feature ở chế độ thử nghiệm, không bỏ baseline.

Regression hiện có để bắt đầu (không phải bằng chứng đã chạy trong lượt lập plan):

```sh
pnpm exec vitest run server/memory-store.test.ts server/turn-context.test.ts server/drivers/agents-mcp-env.test.ts
pnpm exec vitest run server/memory-layer.e2e.test.ts server/team-memory-integrity.e2e.test.ts server/bot-process-autorun.e2e.test.ts
pnpm exec vitest run server/drivers/zcode.test.ts server/drivers/antigravity.test.ts server/drivers/antigravity-runtime.test.ts
```

Các test mới của C0–C6 phải kèm log/evidence trong tài liệu verification riêng,
đánh dấu scripted/native/live. Chỉ đánh DONE sau bằng chứng tương ứng, không chỉ
dựa vào test mock xanh.

## 11. Điều kiện hoàn tất

Ba bot chia sẻ đúng project memory qua provider khác nhau; bot tiếp quản biết
việc đang dở; decision/evidence có nguồn và revision; move/restart không mất dữ
liệu; delete/scope giữ đúng khi backend lỗi. UI bật/tắt và rollback về memory hiện
có hoạt động. Cognee có thể bị gỡ hoặc index được rebuild mà không mất record gốc.

Hiện tại mới hoàn tất plan và khảo sát source/tài liệu upstream. C0–C6 chưa triển
khai; chưa có kết quả thực nghiệm Cognee hoặc kết quả mới của Zcode/AGY.
