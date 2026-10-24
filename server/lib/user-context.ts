export class UserContext {
  readonly corp_id: string;
  readonly corp_name: string;
  readonly emp_id: string;
  readonly name: string;
  readonly avatar: string;
  readonly app_id: string;

  constructor(data: { corp_id?: string; corp_name?: string;emp_id?: string; name?: string; avatar?: string; app_id?: string }) {
    this.corp_id = data.corp_id || '';
    this.corp_name = data.corp_name || '';
    this.emp_id = data.emp_id || '';
    this.name = data.name || '';
    this.avatar = data.avatar || '';
    this.app_id = data.app_id || '';
  }

  get isAuthenticated(): boolean {
    return !!this.corp_id;
  }
}
