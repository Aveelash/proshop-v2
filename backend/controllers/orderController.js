import asyncHandler from "../middleware/asyncHandler.js";
import Order from "../models/orderModel.js";
import Product from "../models/productModel.js";
import { calcPrices } from "../utils/calcPrices.js";
import { verifyPayPalPayment, checkIfNewTransaction } from "../utils/paypal.js";

// Create a new order
// POST /api/orders
// Private
const addOrderItems = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod } = req.body;

  if (!orderItems || orderItems.length === 0) {
    res.status(400);
    throw new Error("No order items");
  }

  const itemsFromDB = await Product.find({
    _id: { $in: orderItems.map((x) => x._id) },
  });

  const dbOrderItems = orderItems.map((itemFromClient) => {
    const matchingItemFromDB = itemsFromDB.find(
      (itemFromDB) => itemFromDB._id.toString() === itemFromClient._id
    );

    if (!matchingItemFromDB) {
      throw new Error(`Product not found: ${itemFromClient._id}`);
    }

    return {
      product: itemFromClient._id,
      name: matchingItemFromDB.name,
      image: matchingItemFromDB.image,
      price: matchingItemFromDB.price,
      qty: Number(itemFromClient.qty),
    };
  });

  const { itemsPrice, taxPrice, shippingPrice, totalPrice } =
    calcPrices(dbOrderItems);

  const order = new Order({
    orderItems: dbOrderItems,
    user: req.user._id,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
  });

  const createdOrder = await order.save();
  res.status(201).json(createdOrder);
});

// Get logged in user orders
// GET /api/orders/myorders
// Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.status(200).json(orders);
});

// Get order by id
// POST /api/orders/:id
// Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    "user",
    "name email"
  );

  if (order) {
    res.status(200).json(order);
  } else {
    res.status(404);
    throw new Error("Order not found");
  }
});

// update order to paid
// PUT /api/orders/:id/pay
// Private
const updateOrderToPaid = asyncHandler(async (req, res) => {
  const { id: transactionId, status, update_time, payer } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  const { verified, value } = await verifyPayPalPayment(transactionId);

  if (!verified) {
    res.status(400);
    throw new Error("Payment not verified");
  }

  const isNewTransaction = await checkIfNewTransaction(Order, transactionId);
  if (!isNewTransaction) {
    res.status(400);
    throw new Error("Transaction has already been used");
  }

  const paidCorrectAmount = order.totalPrice.toString() === value;
  if (!paidCorrectAmount) {
    res.status(400);
    throw new Error("Incorrect amount paid");
  }

  order.isPaid = true;
  order.paidAt = Date.now();
  order.paymentResult = {
    id: transactionId,
    status,
    update_time,
    email_address: payer?.email_address,
  };

  const updatedOrder = await order.save();
  res.json(updatedOrder);
});

// Update order to delivered
// PUT /api/orders/:id/deliver
// Private/Admin
const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isDelivered = true;
    order.deliveredAt = Date.now();

    const updatedOrder = await order.save();

    res.status(200).json(updatedOrder);
  } else {
    res.status(404);
    throw new Error("Order not found");
  }
});

// Get all orders
// GET /api/orders
// Private/Admin
const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate("user", "id name");
  res.status(200).json(orders);
});

export {
  addOrderItems,
  getMyOrders,
  getOrderById,
  updateOrderToDelivered,
  updateOrderToPaid,
  getOrders,
};
