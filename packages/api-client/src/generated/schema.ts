export interface paths {
  "/": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              service: string;
              status: string;
            };
          };
        };
      };
    };
  };
  "/health": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              status: "ok";
              service: string;
              timestamp: string;
            };
          };
        };
      };
    };
  };
}

export interface components {
  schemas: never;
}
