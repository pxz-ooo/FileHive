"""
生成测试数据：各分类 + 各消息类型 + 不同时间分布 + 项目。
使用 requests 库调用本地 API。
"""
import json
import time
import random
import requests

BASE = "http://localhost:8000"

# 测试数据
test_data = [
    # 工作 (5条)
    {"cat": "工作", "type": "text", "content": "项目方案初稿 v2，需要周五前完成需求评审", "days": 0},
    {"cat": "工作", "type": "file", "content": "季度财务报表汇总.xlsx", "days": 1},
    {"cat": "工作", "type": "link", "content": "https://www.infoq.cn/article/software-architecture-2025", "days": 2},
    {"cat": "工作", "type": "text", "content": "今天和客户确认了上线时间，定在下周三", "days": 7},
    {"cat": "工作", "type": "file", "content": "技术方案设计文档_v3.docx", "days": 14},

    # 羽球 (3条)
    {"cat": "羽球", "type": "text", "content": "周六下午2点老地方打球，报名接龙", "days": 0},
    {"cat": "羽球", "type": "text", "content": "新买了YY的球拍，明天带到球场试试", "days": 3},
    {"cat": "羽球", "type": "link", "content": "https://www.badmintoncn.com/news/rackets-2025", "days": 10},

    # 生活 (4条)
    {"cat": "生活", "type": "text", "content": "周末去山姆采购，有没有要带的", "days": 0},
    {"cat": "生活", "type": "text", "content": "发现一家新开的粤菜馆，味道不错推荐", "days": 1},
    {"cat": "生活", "type": "text", "content": "物业说下周要检修燃气，家里留人", "days": 5},
    {"cat": "生活", "type": "image", "content": "厨房新买的锅到了，开锅视频", "days": 20},

    # 通知 (3条)
    {"cat": "通知", "type": "text", "content": "【公司通知】周五下午全员大会，请准时参加", "days": 0},
    {"cat": "通知", "type": "link", "content": "https://www.gov.cn/policy/2025/notice", "days": 4},
    {"cat": "通知", "type": "text", "content": "小区业委会通知：本周末停水检修", "days": 8},

    # 杂记 (3条)
    {"cat": "杂记", "type": "text", "content": "记录一个想法：做一个个人知识管理系统", "days": 1},
    {"cat": "杂记", "type": "text", "content": "今天看到一个有意思的观点：少即是多", "days": 6},
    {"cat": "杂记", "type": "link", "content": "https://www.ruanyifeng.com/blog/2025/weekly-issue", "days": 15},

    # 娱乐 (3条)
    {"cat": "娱乐", "type": "link", "content": "https://www.bilibili.com/video/BV1xxx 这个UP主的测评很有趣", "days": 0},
    {"cat": "娱乐", "type": "text", "content": "周末去看了《流浪地球3》，特效炸裂", "days": 2},
    {"cat": "娱乐", "type": "text", "content": "推荐一个Netflix新剧，三天追完了", "days": 12},

    # 其他 (2条)
    {"cat": "其他", "type": "text", "content": "随机看到一个好玩的东西", "days": 0},
    {"cat": "其他", "type": "text", "content": "等地铁时想到的零碎想法", "days": 3},
]


def submit(content, msg_type):
    r = requests.post(f"{BASE}/ingest", data={
        "content": content,
        "msg_type": msg_type,
    }, timeout=10)
    return r.json()


def update_analysis(msgid, desc):
    r = requests.put(f"{BASE}/messages/{msgid}/analysis", data={"desc": desc}, timeout=10)
    return r.json()


def create_project(name):
    r = requests.post(f"{BASE}/projects", data={"name": name}, timeout=10)
    return r.json()


def assign_project(msgid, project_id):
    r = requests.put(f"{BASE}/messages/{msgid}/project", data={"project_id": project_id}, timeout=10)
    return r.json()


def main():
    print("=" * 40)
    print("开始生成测试数据...")
    print("=" * 40)

    # 1. 提交消息
    msgids = []
    print(f"\n📝 准备提交 {len(test_data)} 条消息...")

    for i, item in enumerate(test_data):
        # 调整时间：days天后
        fake_time = int(time.time()) - item["days"] * 86400 + random.randint(0, 43200)
        print(f"  [{i+1}/{len(test_data)}] {item['cat']} - {item['type']}: {item['content'][:30]}...")

        result = submit(item["content"], item["type"])
        if "msgid" in result:
            msgids.append(result["msgid"])
            # 设置描述
            update_analysis(result["msgid"], item["content"][:40])
        else:
            print(f"     ❌ 提交失败: {result}")

    print(f"\n✅ 共提交 {len(msgids)} 条消息")

    # 2. 创建项目
    print("\n📁 创建项目...")
    projects = ["工作项目", "生活点滴"]
    project_ids = []
    for name in projects:
        r = create_project(name)
        if "id" in r:
            project_ids.append(r["id"])
            print(f"  ✅ 项目 '{name}' 创建成功 (id={r['id']})")
        else:
            print(f"  ❌ 项目 '{name}' 创建失败: {r}")

    # 3. 分配项目
    if project_ids:
        print("\n🔗 分配消息到项目...")
        for i, mid in enumerate(msgids[:5]):  # 前5条到工作项目
            if project_ids:
                assign_project(mid, project_ids[0 if i < 3 else 1])
                print(f"  📎 msgid={mid[:20]}... → {'工作项目' if i < 3 else '生活点滴'}")
            else:
                break

    print("\n" + "=" * 40)
    print("🎉 测试数据生成完成！")
    print(f"  消息总数: {len(msgids)}")
    print(f"  项目数: {len(project_ids)}")
    print("=" * 40)


if __name__ == "__main__":
    main()
