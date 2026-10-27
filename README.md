# cocParse

通过 GitHub Actions 自动部署到 GitHub Pages 的静态网站。

网站地址（首次部署成功后可访问）：https://leasin9.github.io/cocParse/

## 首次启用

1. 打开仓库的 [Settings → Pages](https://github.com/leasin9/cocParse/settings/pages)。
2. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
3. 打开 [Actions](https://github.com/leasin9/cocParse/actions/workflows/pages.yml)，选择 **Deploy static site to GitHub Pages → Run workflow → main**，触发首次部署。

之后每次推送到 `main`，网站都会自动更新。也可以从 Actions 手动触发部署。

## 开发

网页文件放在 `public/`，首页为 `public/index.html`。部署时仅上传这个目录。

本地预览：

```sh
python3 -m http.server 8000 --directory public
```

访问 http://localhost:8000/。

项目部署在 `/cocParse/` 子路径，引用站内资源时使用 `./styles.css` 等相对路径。

部署配置：`.github/workflows/pages.yml`，基于 GitHub 官方 [静态网站模板](https://github.com/actions/starter-workflows/blob/main/pages/static.yml)。
