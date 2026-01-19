/**
 * PureMVC Framework Core
 * Simplified implementation for Cocos Creator
 */

export class Notification {
  constructor(
    public name: string,
    public body?: any,
    public type?: string
  ) {}
}

export interface IObserver {
  notifyObserver(notification: Notification): void;
  setNotifyMethod(method: Function): void;
  setNotifyContext(context: any): void;
  compareNotifyContext(object: any): boolean;
}

export class Observer implements IObserver {
  private notify: Function | null = null;
  private context: any = null;

  constructor(notifyMethod: Function, notifyContext: any) {
    this.setNotifyMethod(notifyMethod);
    this.setNotifyContext(notifyContext);
  }

  setNotifyMethod(notifyMethod: Function): void {
    this.notify = notifyMethod;
  }

  setNotifyContext(notifyContext: any): void {
    this.context = notifyContext;
  }

  notifyObserver(notification: Notification): void {
    if (this.notify) {
      this.notify.call(this.context, notification);
    }
  }

  compareNotifyContext(object: any): boolean {
    return object === this.context;
  }
}

export interface INotifier {
  sendNotification(name: string, body?: any, type?: string): void;
}

export class Notifier implements INotifier {
  protected facade: IFacade | null = null;

  constructor(facade?: IFacade) {
    this.facade = facade || Facade.getInstance();
  }

  sendNotification(name: string, body?: any, type?: string): void {
    if (this.facade) {
      this.facade.sendNotification(name, body, type);
    }
  }
}

export interface IView {
  registerObserver(notificationName: string, observer: IObserver): void;
  removeObserver(notificationName: string, notifyContext: any): void;
  notifyObservers(notification: Notification): void;
  registerMediator(mediator: IMediator): void;
  retrieveMediator(mediatorName: string): IMediator | null;
  removeMediator(mediatorName: string): IMediator | null;
  hasMediator(mediatorName: string): boolean;
}

export class View implements IView {
  private static instance: IView | null = null;
  private mediatorMap: Map<string, IMediator> = new Map();
  private observerMap: Map<string, IObserver[]> = new Map();

  static getInstance(): IView {
    if (!View.instance) {
      View.instance = new View();
    }
    return View.instance;
  }

  registerObserver(notificationName: string, observer: IObserver): void {
    if (!this.observerMap.has(notificationName)) {
      this.observerMap.set(notificationName, []);
    }
    const observers = this.observerMap.get(notificationName)!;
    observers.push(observer);
  }

  removeObserver(notificationName: string, notifyContext: any): void {
    const observers = this.observerMap.get(notificationName);
    if (!observers) return;

    for (let i = observers.length - 1; i >= 0; i--) {
      if (observers[i].compareNotifyContext(notifyContext)) {
        observers.splice(i, 1);
        break;
      }
    }

    if (observers.length === 0) {
      this.observerMap.delete(notificationName);
    }
  }

  notifyObservers(notification: Notification): void {
    const observers = this.observerMap.get(notification.name);
    if (observers) {
      const observersCopy = [...observers];
      observersCopy.forEach(observer => {
        observer.notifyObserver(notification);
      });
    }
  }

  registerMediator(mediator: IMediator): void {
    if (this.mediatorMap.has(mediator.getMediatorName())) {
      return;
    }
    this.mediatorMap.set(mediator.getMediatorName(), mediator);
    const interests = mediator.listNotificationInterests();
    if (interests.length > 0) {
      const observer = new Observer(mediator.handleNotification.bind(mediator), mediator);
      interests.forEach(interest => {
        this.registerObserver(interest, observer);
      });
    }
    mediator.onRegister();
  }

  retrieveMediator(mediatorName: string): IMediator | null {
    return this.mediatorMap.get(mediatorName) || null;
  }

  removeMediator(mediatorName: string): IMediator | null {
    const mediator = this.mediatorMap.get(mediatorName);
    if (!mediator) return null;

    const interests = mediator.listNotificationInterests();
    interests.forEach(interest => {
      this.removeObserver(interest, mediator);
    });
    this.mediatorMap.delete(mediatorName);
    mediator.onRemove();
    return mediator;
  }

  hasMediator(mediatorName: string): boolean {
    return this.mediatorMap.has(mediatorName);
  }
}

export interface IModel {
  registerProxy(proxy: IProxy): void;
  removeProxy(proxyName: string): IProxy | null;
  retrieveProxy(proxyName: string): IProxy | null;
  hasProxy(proxyName: string): boolean;
}

export class Model implements IModel {
  private static instance: IModel | null = null;
  private proxyMap: Map<string, IProxy> = new Map();

  static getInstance(): IModel {
    if (!Model.instance) {
      Model.instance = new Model();
    }
    return Model.instance;
  }

  registerProxy(proxy: IProxy): void {
    this.proxyMap.set(proxy.getProxyName(), proxy);
    proxy.onRegister();
  }

  removeProxy(proxyName: string): IProxy | null {
    const proxy = this.proxyMap.get(proxyName);
    if (!proxy) return null;
    this.proxyMap.delete(proxyName);
    proxy.onRemove();
    return proxy;
  }

  retrieveProxy(proxyName: string): IProxy | null {
    return this.proxyMap.get(proxyName) || null;
  }

  hasProxy(proxyName: string): boolean {
    return this.proxyMap.has(proxyName);
  }
}

export interface IController {
  registerCommand(notificationName: string, commandClassRef: new () => ICommand): void;
  executeCommand(notification: Notification): void;
  removeCommand(notificationName: string): void;
  hasCommand(notificationName: string): boolean;
}

export class Controller implements IController {
  private static instance: IController | null = null;
  private commandMap: Map<string, new () => ICommand> = new Map();
  private view: IView;

  constructor() {
    this.view = View.getInstance();
  }

  static getInstance(): IController {
    if (!Controller.instance) {
      Controller.instance = new Controller();
    }
    return Controller.instance;
  }

  registerCommand(notificationName: string, commandClassRef: new () => ICommand): void {
    if (this.commandMap.has(notificationName)) {
      return;
    }
    this.commandMap.set(notificationName, commandClassRef);
  }

  executeCommand(notification: Notification): void {
    const commandClassRef = this.commandMap.get(notification.name);
    if (!commandClassRef) return;

    const commandInstance = new commandClassRef();
    commandInstance.execute(notification);
  }

  removeCommand(notificationName: string): void {
    if (this.hasCommand(notificationName)) {
      this.commandMap.delete(notificationName);
    }
  }

  hasCommand(notificationName: string): boolean {
    return this.commandMap.has(notificationName);
  }
}

export interface IFacade extends INotifier {
  registerCommand(notificationName: string, commandClassRef: new () => ICommand): void;
  removeCommand(notificationName: string): void;
  registerProxy(proxy: IProxy): void;
  retrieveProxy(proxyName: string): IProxy | null;
  removeProxy(proxyName: string): IProxy | null;
  registerMediator(mediator: IMediator): void;
  retrieveMediator(mediatorName: string): IMediator | null;
  removeMediator(mediatorName: string): IMediator | null;
}

export class Facade implements IFacade {
  private static instance: IFacade | null = null;
  protected model: IModel;
  protected view: IView;
  protected controller: IController;

  protected constructor() {
    this.model = Model.getInstance();
    this.view = View.getInstance();
    this.controller = Controller.getInstance();
    this.initializeFacade();
  }

  static getInstance(): IFacade {
    if (!Facade.instance) {
      Facade.instance = new Facade();
    }
    return Facade.instance;
  }

  protected initializeFacade(): void {
    this.initializeModel();
    this.initializeController();
    this.initializeView();
  }

  protected initializeModel(): void {}
  protected initializeController(): void {}
  protected initializeView(): void {}

  registerCommand(notificationName: string, commandClassRef: new () => ICommand): void {
    this.controller.registerCommand(notificationName, commandClassRef);
  }

  removeCommand(notificationName: string): void {
    this.controller.removeCommand(notificationName);
  }

  registerProxy(proxy: IProxy): void {
    this.model.registerProxy(proxy);
  }

  retrieveProxy(proxyName: string): IProxy | null {
    return this.model.retrieveProxy(proxyName);
  }

  removeProxy(proxyName: string): IProxy | null {
    return this.model.removeProxy(proxyName);
  }

  registerMediator(mediator: IMediator): void {
    this.view.registerMediator(mediator);
  }

  retrieveMediator(mediatorName: string): IMediator | null {
    return this.view.retrieveMediator(mediatorName);
  }

  removeMediator(mediatorName: string): IMediator | null {
    return this.view.removeMediator(mediatorName);
  }

  sendNotification(name: string, body?: any, type?: string): void {
    this.notifyObservers(new Notification(name, body, type));
  }

  notifyObservers(notification: Notification): void {
    this.view.notifyObservers(notification);
  }
}

export interface IProxy extends INotifier {
  getProxyName(): string;
  setData(data: any): void;
  getData(): any;
  onRegister(): void;
  onRemove(): void;
}

export class Proxy extends Notifier implements IProxy {
  private proxyName: string;
  private data: any;

  constructor(proxyName: string, data?: any) {
    super();
    this.proxyName = proxyName;
    this.data = data || null;
  }

  getProxyName(): string {
    return this.proxyName;
  }

  setData(data: any): void {
    this.data = data;
  }

  getData(): any {
    return this.data;
  }

  onRegister(): void {}
  onRemove(): void {}
}

export interface IMediator extends INotifier {
  getMediatorName(): string;
  getViewComponent(): any;
  setViewComponent(viewComponent: any): void;
  listNotificationInterests(): string[];
  handleNotification(notification: Notification): void;
  onRegister(): void;
  onRemove(): void;
}

export class Mediator extends Notifier implements IMediator {
  protected mediatorName: string;
  protected viewComponent: any;

  constructor(mediatorName: string, viewComponent?: any) {
    super();
    this.mediatorName = mediatorName;
    this.viewComponent = viewComponent || null;
  }

  getMediatorName(): string {
    return this.mediatorName;
  }

  getViewComponent(): any {
    return this.viewComponent;
  }

  setViewComponent(viewComponent: any): void {
    this.viewComponent = viewComponent;
  }

  listNotificationInterests(): string[] {
    return [];
  }

  handleNotification(notification: Notification): void {}

  onRegister(): void {}
  onRemove(): void {}
}

export interface ICommand extends INotifier {
  execute(notification: Notification): void;
}

export class SimpleCommand extends Notifier implements ICommand {
  execute(notification: Notification): void {}
}
