# P2P TURN 服务器部署指南

本文档介绍如何部署 coturn TURN 服务器，以支持 NAT 穿透失败时的 P2P 中转传输。

## 为什么需要 TURN？

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NAT 穿透失败场景                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   STUN 成功时:                       STUN 失败时:                            │
│                                                                             │
│   设备 A ──STUN──▶ 发现公网IP         设备 A ──STUN──▶ 发现公网IP             │
│   设备 A ────────▶ 设备 B (直连)      设备 A ────────▶ 设备 B                 │
│                   ↑                       ↓ 失败 (Symmetric NAT)            │
│                   │                       ↓                                 │
│                直连成功                   需要 TURN 中转:                    │
│                                         ┌───────────────────────────────┐  │
│                                         │ 设备 A ──▶ TURN ──▶ 设备 B    │  │
│                                         │        (服务器中转)           │  │
│                                         └───────────────────────────────┘  │
│                                                                             │
│   TURN 适用场景:                                                            │
│   - Symmetric NAT (企业网络常见)                                            │
│   - 双层 NAT (运营商级 NAT)                                                 │
│   - 防火墙严格限制入站连接                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 方案一：使用公共 TURN 服务

### Twilio TURN (推荐)

```env
# .env
TURN_URL=turn:turn.twilio.com:3478
TURN_USERNAME=your-twilio-username
TURN_CREDENTIAL=your-twilio-password
```

需要注册 Twilio 账户获取凭证。

### Metered TURN (免费额度)

```env
TURN_URL=turn:turn.metered.ca:80
TURN_USERNAME=your-metered-username
TURN_CREDENTIAL=your-metered-password
```

---

## 方案二：自建 coturn 服务器

### 1. 安装 coturn

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install coturn

# CentOS/RHEL
sudo yum install coturn

# macOS
brew install coturn
```

### 2. 配置 coturn

编辑 `/etc/turnserver.conf`:

```conf
# 监听端口
listening-port=3478
tls-listening-port=5349

# 监听 IP (替换为你的服务器公网 IP)
listening-ip=YOUR_SERVER_IP
relay-ip=YOUR_SERVER_IP

# 外部 IP (如果服务器在 NAT 后面)
external-ip=YOUR_PUBLIC_IP

# 认证
use-auth-secret
static-auth-secret=your-secret-key-here  # 替换为随机生成的密钥

# 用户认证方式 (推荐使用时间戳认证)
# 或使用固定用户名密码:
# user=username:password

# 域名
realm=your-domain.com

# TLS 证书 (可选，推荐生产环境)
cert=/etc/letsencrypt/live/your-domain.com/fullchain.pem
pkey=/etc/letsencrypt/live/your-domain.com/privkey.pem

# 日志
log-file=/var/log/turnserver.log
verbose

# 性能配置
min-port=49152
max-port=65535
max-bps=1000000  # 最大带宽 1MB/s

# 安全配置
no-multicast
no-loopback-peers
denied-peer-ip=0.0.0.0-0.255.255.255  # 拕绝私有 IP
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

### 3. 生成认证密钥

```bash
# 生成随机密钥
openssl rand -hex 32

# 或使用 turnadmin 生成
turnadmin -k -a -u username -p password -r your-domain.com
```

### 4. 启动服务

```bash
# systemd 管理
sudo systemctl enable coturn
sudo systemctl start coturn

# 或直接启动
turnserver -c /etc/turnserver.conf
```

### 5. 防火墙配置

```bash
# 开放 TURN 端口
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp  # TLS
sudo ufw allow 49152:65535/udp  # relay 端口范围
```

### 6. 配置 AirPortal

```env
# .env
TURN_URL=turn:your-server.com:3478
TURN_USERNAME=username
TURN_CREDENTIAL=password

# 或使用 TURNS (TLS 加密)
TURN_URL=turns:your-server.com:5349
```

---

## 方案三：时间戳认证 (推荐生产环境)

时间戳认证比固定密码更安全，凭证会过期自动失效。

### 服务器配置

```conf
# /etc/turnserver.conf
use-auth-secret
static-auth-secret=your-shared-secret
realm=your-domain.com
```

### 生成临时凭证

在 AirPortal 后端动态生成：

```typescript
import crypto from 'crypto';

function generateTurnCredentials(): { username: string; credential: string } {
  const secret = process.env.TURN_SECRET!;
  const ttl = 86400; // 24 小时有效期
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:airportal-user`;
  const credential = crypto
    .createHmac('sha1', secret)
    .update(username)
    .digest('base64');
  return { username, credential };
}
```

---

## 验证 TURN 服务

### 使用 turnutils_uclient 测试

```bash
# 安装测试工具
sudo apt install coturn  # 包含 turnutils_uclient

# 测试 TURN 连接
turnutils_uclient -v -u username -w password your-server.com
```

### 在浏览器中验证

```javascript
// Chrome DevTools Console
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:your-server.com:3478', username: 'test', credential: 'test' }
  ]
});

pc.createDataChannel('test');
pc.createOffer().then(offer => {
  pc.setLocalDescription(offer);
  console.log('ICE Candidates:', pc.localDescription.sdp);
});
```

查看 SDP 中是否包含 `relay` candidate：
```
a=candidate:... relay ...
```

---

## 云服务商 TURN 方案

| 服务商 | 方案 | 成本 |
|--------|------|------|
| AWS | 自建 coturn on EC2 | 按流量计费 |
| GCP | Cloud NAT + coturn | 按流量计费 |
| Azure | 自建 coturn | 按流量计费 |
| DigitalOcean | $5/月 droplet | 固定 |
| Twilio | Network Traversal Service | 按使用量 |

---

## 性能估算

```
单次 P2P 传输 TURN 中转流量:
- 10MB 文件: ~10MB TURN 流量 (双向约 20MB)
- 100MB 文件: ~100MB TURN 流量

建议配置:
- 低频使用: 1GB/月 TURN 流量足够
- 中频使用: 10GB/月
- 高频使用: 需专用服务器或商业 TURN 服务
```

---

## 常见问题

### Q: 如何判断是否需要 TURN？

A: 查看 WebRTC ICE 连接状态：
```javascript
pc.oniceconnectionstatechange = () => {
  console.log('ICE state:', pc.iceConnectionState);
  // 'connected' = 直连成功
  // 'failed' = 需要 TURN
};
```

### Q: TURN 会增加延迟吗？

A: 是的，TURN 中转比直连增加约 20-50ms 延迟。但对于文件传输，影响较小。

### Q: TURN 数据安全吗？

A: TURN 服务器可以看到传输数据内容。建议：
1. 使用 TURNS (TLS 加密)
2. 应用层加密敏感数据
3. 使用可信的 TURN 服务

### Q: coturn 内存占用多少？

A: 每个连接约 100KB，1000 并发连接约 100MB。