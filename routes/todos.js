const router = require('express').Router();
const AV = require('leanengine');

// 获取所有 Todo
router.get('/', async function(req, res) {
  try {
    const query = new AV.Query('Todo');
    query.descending('createdAt');
    
    // 支持分页
    const limit = parseInt(req.query.limit) || 10;
    const skip = parseInt(req.query.skip) || 0;
    query.limit(limit);
    query.skip(skip);
    
    const todos = await query.find();
    
    res.json({
      success: true,
      data: todos.map(todo => ({
        id: todo.id,
        title: todo.get('title'),
        completed: todo.get('completed'),
        createdAt: todo.get('createdAt'),
        updatedAt: todo.get('updatedAt')
      })),
      pagination: {
        limit: limit,
        skip: skip
      }
    });
  } catch (error) {
    console.error('获取 Todo 列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 创建新的 Todo
router.post('/', async function(req, res) {
  try {
    const { title, completed = false } = req.body;
    
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '标题不能为空'
      });
    }
    
    const Todo = AV.Object.extend('Todo');
    const todo = new Todo();
    
    todo.set('title', title.trim());
    todo.set('completed', completed);
    
    const savedTodo = await todo.save();
    
    res.status(201).json({
      success: true,
      data: {
        id: savedTodo.id,
        title: savedTodo.get('title'),
        completed: savedTodo.get('completed'),
        createdAt: savedTodo.get('createdAt'),
        updatedAt: savedTodo.get('updatedAt')
      }
    });
  } catch (error) {
    console.error('创建 Todo 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取单个 Todo
router.get('/:id', async function(req, res) {
  try {
    const query = new AV.Query('Todo');
    const todo = await query.get(req.params.id);
    
    res.json({
      success: true,
      data: {
        id: todo.id,
        title: todo.get('title'),
        completed: todo.get('completed'),
        createdAt: todo.get('createdAt'),
        updatedAt: todo.get('updatedAt')
      }
    });
  } catch (error) {
    console.error('获取 Todo 失败:', error);
    if (error.code === 101) { // 对象不存在
      res.status(404).json({
        success: false,
        error: 'Todo 不存在'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

// 更新 Todo
router.put('/:id', async function(req, res) {
  try {
    const { title, completed } = req.body;
    
    const query = new AV.Query('Todo');
    const todo = await query.get(req.params.id);
    
    if (title !== undefined) {
      if (!title || title.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: '标题不能为空'
        });
      }
      todo.set('title', title.trim());
    }
    
    if (completed !== undefined) {
      todo.set('completed', completed);
    }
    
    const updatedTodo = await todo.save();
    
    res.json({
      success: true,
      data: {
        id: updatedTodo.id,
        title: updatedTodo.get('title'),
        completed: updatedTodo.get('completed'),
        createdAt: updatedTodo.get('createdAt'),
        updatedAt: updatedTodo.get('updatedAt')
      }
    });
  } catch (error) {
    console.error('更新 Todo 失败:', error);
    if (error.code === 101) { // 对象不存在
      res.status(404).json({
        success: false,
        error: 'Todo 不存在'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

// 删除 Todo
router.delete('/:id', async function(req, res) {
  try {
    const query = new AV.Query('Todo');
    const todo = await query.get(req.params.id);
    
    await todo.destroy();
    
    res.json({
      success: true,
      message: 'Todo 已删除'
    });
  } catch (error) {
    console.error('删除 Todo 失败:', error);
    if (error.code === 101) { // 对象不存在
      res.status(404).json({
        success: false,
        error: 'Todo 不存在'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

module.exports = router;