// 回給前端的錯誤：status 和一個短的 error 代碼（前端照代碼換成看得懂的話），extra 會併進回應
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
