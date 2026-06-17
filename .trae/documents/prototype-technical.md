## 1. 架構設計
```mermaid
flowchart LR
    A["前端介面"] --> B["部門資料模型"]
    A --> C["平面圖 Overlay 渲染"]
    B --> D["靜態 JSON/JavaScript 設定"]
    C --> E["底圖資源 current-page.png"]
```

## 2. 技術說明
- 前端：原生 `HTML` + `CSS` + `JavaScript`
- 初始化方式：直接以單頁 `index.html` 實作，方便快速展示 prototype
- 後端：`None`
- 資料來源：前端內嵌 department menu source、`CONNECT` 連結資料同座標設定

## 3. 路由定義
| 路由 | 用途 |
|------|------|
| / | 顯示互動式 department 平面圖 prototype |

## 4. API 定義
呢個 prototype 唔需要後端 API，資料直接喺前端定義，並以前端函式根據 `Department List` 同 `CONNECT` 產生高亮結果。

```ts
type DepartmentArea = {
  id: string;
  code: string;
  name: string;
  color: string;
  description: string;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

type DepartmentSelection = {
  tower: "left" | "right";
  floor: string;
  index: number;
  buildingIndex?: number;
  wing?: string;
};
```

## 5. 資料模型
### 5.1 資料模型定義
```mermaid
erDiagram
    DEPARTMENT_AREA {
        string id
        string code
        string name
        string color
        string description
        number left
        number top
        number width
        number height
    }
```

### 5.2 資料定義說明
- `Department List` 由既有 menu source rows 重建
- department 點擊後會先展開子清單，再用 `CONNECT` 已對應嘅 item 批量組合 `DepartmentSelection`
- 高亮結果同 link panel 共用同一組前端 selection state
- 後續如要擴充，可將資料搬去獨立 JSON 或 CMS
