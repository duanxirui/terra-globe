# TERRA — 交互式 3D 地球

基于 **Three.js** 的全屏地球探索页面，采用深色太空设计。地理数据只按**国家 / 地区 → 省、州及同级行政区**两级显示，另有五大洋标注、旋转、缩放和边界识别。

## 启动

需要 Node.js 18 或更新版本。进入本目录，运行：

```bash
npm run dev
```

浏览器打开终端输出的地址，默认是 **http://localhost:4173**。如果端口被其他程序占用，开发服务器会自动尝试 `4174`、`4175` 等端口。也可以通过环境变量 `PORT` 明确指定端口。

无需执行 `npm install`：项目中的 Three.js 和世界地图数据已经保存在 `assets/`，可在离线环境运行；页面字体会自动回退到本地系统字体。

## 操作

- **拖拽地球**：自由旋转，支持鼠标和触摸屏。
- **鼠标滚轮、右侧 + / −**：放大或缩小。
- **按缩放显示地名**：初始视角显示国家 / 地区和海洋；放大后显示省州及其边界，在最大放大倍率下仍停留在省州层。不加载或展示城市、县区、乡镇和村庄；标签过密时自动隐藏部分名称。
- **中英文切换**：地球下方的“中文 / EN”按钮可切换地图标签、搜索建议、详情和主要界面文字，已选位置的名称同步更新。
- **搜索名称**：右上方支持中文或英文搜索国家和省州，选中后自动转到目标位置并调整缩放。
- **点击国家或省州**：显示坐标与地名，有边界的行政区会高亮轮廓；仅有参考点的省州仍可从名称标签或搜索结果选中。
- **海洋 / 国家 / 省州 / 国界 / 经纬网 / 自动旋转**：使用地球下方的开关自由切换。
- **开始探索**：飞往一个随机地理区域。
- **重置视角 / 准星按钮**：返回初始视角。
- **右上角按钮**：切换全屏（取决于浏览器支持）。

## 文件

- `index.html` — 页面结构和交互控件。
- `styles.css` — 响应式视觉风格。
- `main.js` — Three.js 场景、球面投影、地形纹理、行政边界、定位和交互。
- `geo-lookup.js` — TopoJSON 解码、跨 180° 经线的国家与省州命中判断，处理跨日界线的多边形并缓存几何信息。
- `map-labels.js` — 五大洋、国家及省州的球面文字投影、背面剔除、缩放策略及标签避让。
- `geography-levels.js` — 省州一级层级筛选规则，供数据构建使用。
- `current-tier-overrides.js` — 肯尼亚、布基纳法索、几内亚现行一级区划，以及新西兰地理岛群的层级修订。
- `assets/primary-division-reference-points.json` — 72 条经过筛选的省州级行政区参考坐标，供离线重建使用，**不包含城市目录**。
- `province-completions.js` — 为英、法、意、西、马达加斯加补入经核对的一级行政区名称与参考坐标。
- `reform-administrations.js` — 越南、尼泊尔、印尼、刚果（金）、埃塞俄比亚、哈萨克斯坦等行政区划变动与名称修正。
- `place-names.js` — 地名中英文选择和缩放级别配置。
- `geography-corrections.js` — 经核实的个别行政地名修正，不改动原始边界。
- `assets/three.module.js` — Three.js r165 ESM 构建。
- `assets/countries-50m.json` — 优先使用的 1:50m 国家 / 地区边界（world-atlas TopoJSON）。
- `assets/countries-110m.json` — 备用国家边界。
- `assets/map-labels-admin1.json` — 242 条国家名称与 4,589 条混合行政区旧数据，作为构建输入，页面不再直接使用。
- `assets/map-labels-admin1-current.json` — 正式运行使用的 3,301 条省州级记录，含 230 条无可靠边界的参考点。
- `scripts/build-admin-current.mjs` — 从原始数据、行政区调整和补充名录构建独立的现行层级文件。
- `scripts/prepare-map-data.cjs` — 从 Natural Earth GeoJSON 重新生成行政区划与中文名称数据的脚本。
- `scripts/repair-label-anchors.mjs` — 修复点位落在自身简化边界以外的标签；使用 `--write` 更新数据。
- `scripts/audit-geography.mjs` — 国家、行政区定位与标签质量审计，含跨日界线和已知地点检查。
- `scripts/audit-globe-coverage.mjs` — 国家及省州覆盖、区划代码和地名质量审计。
- `scripts/audit-current-tiers.mjs` — 检查正式运行的数据层级、区划数量、重复代码与国家/省州坐标命中。
- `GEOGRAPHY-AUDIT.md` — 本项目的数据完整性及文案审查记录、已修复问题和待处理问题。
- `assets/*-LICENSE.txt` — 内置开源资源的许可证。
- `server.cjs` — 无第三方依赖的本地静态 HTTP 服务器。

## 地图数据说明

地图标注随视距自动控制数量：远景优先显示五大洋和国家，放大后显示省州一级区划；再放大也不会切换到更低的层级。标签密集时自动避让；即使名称未同时显示，已收录的国家和省州仍可通过搜索定位。

正式应用只请求国界、国家名称和省州区划资源，**不加载城市数据**。省州级行政区有可用多边形时绘制简化边界；缺失可信边界时仅显示可搜索的参考点。少数省州参考点使用原 GeoNames 行政中心坐标，经重新归并后存为独立的省州级参考坐标。参考坐标来源为 [GeoNames](https://www.geonames.org/)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)），请保留该署名。

国界来自 [world-atlas](https://github.com/topojson/world-atlas)，原始省州源来自 [Natural Earth](https://www.naturalearthdata.com/) 1:10m 简化版。**页面实际只加载 `assets/map-labels-admin1-current.json`**，而非历史构建输入 `assets/map-labels-admin1.json`。正式数据目前包含 **3,301 条省州及同级行政区**，覆盖 **225 个国家 / 地区代码**：其中 **230 条仅有参考点**，3 条合并区划的历史边界不完整。法国 18、意大利 20、西班牙 19、英国 4 和马达加斯加 23 条现行一级区划均已补入参考点；这些地区缺少可信边界，故不绘制猜测的新区界。国家 / 地区为 **242 条名称、241 份边界**；图瓦卢只有文字参考点。

地图适合科普和交互浏览，**不能作为正式行政边界、领土或法律判界依据**。多边形只是所用历史开放底图中尚可对应现行区划的部分；其余已识别的县区、地理区域和旧省份不再混进省州层。全球行政结构制度不统一，目前无法保证每一国家 / 地区的一级区划均完整、最新。

### 已修订的行政区层级与历史数据

原始 Natural Earth 文件保留用于构建；下列国家的公开行政结构已按核查结果修订为现行第一层。无法可靠重建的边界改用**参考位置**，搜索和详情均标明状态：

| 国家 | 原始数据问题 | 正式使用的省州级数据 | 参考 |
| --- | ---: | --- | --- |
| 刚果民主共和国 | 旧 11 省 | 26 个省级单位（拆分区划仅参考点） | [内政部](https://interieur.gouv.cd/ministere/territoires) |
| 印度尼西亚 | 旧 33 省 | 38 个省（新区划部分仅参考点） | [统计局](https://www.bps.go.id/en/) |
| 埃塞俄比亚 | 旧 11 个一级区划 | 12 个州和 2 个自治市 | [司法部](https://justice.gov.et/en/regions/) |
| 越南 | 旧 63 省市及地理区 | 2025 年改革后 34 个省级单位；3 条合并区界不完整 | [政府公告](https://baochinhphu.vn/nghi-quyet-cua-quoc-hoi-ve-sap-xep-don-vi-hanh-chinh-cap-tinh-102250612191145158.htm) |
| 尼泊尔 | 旧 14 专区 | 7 个省（仅参考点） | [尼泊尔政府](https://ntb.gov.np/en/provinces) |
| 布基纳法索 | 旧 45 个省误当地区层 | 2025 年新设的 17 个大区，使用最新本地名称（仅参考点） | [总统府](https://www.presidencedufaso.bf/conseil-des-ministres-du-2-juillet-2025/) |
| 几内亚 | 省州层混进 33 个专区 | 7 个大区 + 科纳克里特别区（仅参考点） | [国土行政部](https://matd.gov.gn/presentation/) |
| 肯尼亚 | 已废止的 8 个省 | 47 郡（仅参考点，参照郡首府） | [宪法](https://www.mod.go.ke/the-constitution-of-kenya-2010-online/) |
| 新西兰 | 5 个地理岛群被误列为行政区 | 16 个地区 + 查塔姆群岛地区，共 17 条 | [新西兰统计局](https://datafinder.stats.govt.nz/layer/120945-regional-council-2025-clipped/) |

另外，南极洲已排除无行政层级意义的省州记录；香港 18 区已从中间层排除。中国台湾地区按当前页面既定展示粒度只保留台北、新北、桃园、台中、台南、高雄六个直辖市；县级行政单位不再混入省州层。韩国“江原特别自治道”“全北特别自治道”及捷克“比尔森州”“兹林州”等中文地名已修订。争议边界依照来源呈现，仅供参考。

其余地区仍可能存在边界简化、行政分类差异、中文名称为非标准译名或仍为繁体字，以及未收录的现行区划。参考点锚定的是行政中心，并非一定为辖区几何中心。要补全准确的边界，需要逐国导入有时间版本且许可明确的权威数据。运行 `node scripts/build-admin-current.mjs` 生成正式省州层，再用 `node scripts/audit-current-tiers.mjs`、`node scripts/audit-globe-coverage.mjs` 查看正式展示数据；`node scripts/audit-geography.mjs` 审查的是**原始**底图。

若需重新生成 `map-labels-admin1.json`，先将 `ne_10m_admin_1_states_provinces.geojson` 和 `ne_50m_admin_0_countries.geojson` 从 [Natural Earth Vector GeoJSON](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) 下载到 `assets/`，然后执行 `node scripts/prepare-map-data.cjs`。
